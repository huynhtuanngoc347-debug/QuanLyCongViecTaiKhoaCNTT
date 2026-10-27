import type { RiskItemDto, RiskLevel, RiskReportDto } from '@khoa/shared';
import type { SqlRunner } from '../db/db.service';
import { Result, fail, ok } from '../common/result';
import { DAY_MS, iso, nowUtc } from '../common/vn-time';
import type { TaskRights } from './task-access';
import { subtree } from './stats.queries';

/**
 * Phân tích nguy cơ trễ hạn của các phân công đang mở, CHƯA quá hạn (việc đã quá hạn xem ở Thống kê đơn vị).
 * Chấm điểm theo quy tắc (0–100) để giải thích được từng lý do, không dùng mô hình học máy:
 *  - tiến độ báo cáo chậm hơn tiến độ kỳ vọng (thời gian đã trôi qua / tổng thời gian),
 *  - còn ít ngày, chưa tiếp nhận, lâu không cập nhật tiến độ, bị yêu cầu bổ sung, đang xin gia hạn,
 *  - lịch sử nộp trễ 12 tháng gần đây và số việc đang ôm của người nhận.
 */
export interface RiskInput {
  status: number; assignedAt: Date; due: Date; progress: number; lastUpdate: Date | null;
  needsWork: number; pendingExtension: boolean; doneLastYear: number; lateLastYear: number; openLoad: number;
}

export const HIGH_RISK = 60, MEDIUM_RISK = 35;

export function riskScore(x: RiskInput, now: Date): { score: number; level: RiskLevel; expected: number; daysLeft: number; reasons: string[] } {
  const span = Math.max(DAY_MS, x.due.getTime() - x.assignedAt.getTime());
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - x.assignedAt.getTime()) / span));
  const expected = Math.round(elapsed * 100);
  const daysLeft = Math.max(0, Math.ceil((x.due.getTime() - now.getTime()) / DAY_MS));
  const reasons: string[] = [];
  let score = 0;
  const gap = expected - x.progress;
  if (gap > 0) {
    score += Math.min(45, gap * 0.5);
    // Số % và số ngày đã có ở cột Tiến độ / Hạn: lý do chỉ cần từ khóa ngắn.
    if (gap >= 20) reasons.push('Chậm tiến độ');
  }
  if (daysLeft <= 3) { score += daysLeft <= 1 ? 20 : 12; reasons.push('Sát hạn'); }
  else if (daysLeft <= 7) score += 5;
  if (x.status === 0 && elapsed > 0.25) { score += 10; reasons.push('Chưa tiếp nhận'); }
  const sinceUpdate = (now.getTime() - (x.lastUpdate ?? x.assignedAt).getTime()) / DAY_MS;
  if (elapsed > 0.3 && sinceUpdate >= 7) { score += 10; reasons.push(x.lastUpdate ? `${Math.floor(sinceUpdate)} ngày chưa cập nhật` : 'Chưa cập nhật'); }
  if (x.needsWork > 0) { score += Math.min(10, x.needsWork * 5); reasons.push(`Bổ sung ${x.needsWork} lần`); }
  if (x.pendingExtension) { score += 10; reasons.push('Xin gia hạn'); }
  // Cần đủ 3 việc đã xong mới tính lịch sử, tránh kết luận từ 1–2 việc.
  if (x.doneLastYear >= 3 && x.lateLastYear > 0) {
    const rate = x.lateLastYear / x.doneLastYear;
    score += Math.round(rate * 20);
    if (rate >= 0.3) reasons.push(`Hay trễ (${x.lateLastYear}/${x.doneLastYear})`);
  }
  if (x.openLoad >= 5) { score += 5; reasons.push(`Ôm ${x.openLoad} việc`); }
  score = Math.min(100, Math.round(score));
  return { score, level: score >= HIGH_RISK ? 'high' : score >= MEDIUM_RISK ? 'medium' : 'low', expected, daysLeft, reasons };
}

interface RiskRow {
  MaPhanCong: number; MaCongViec: number; TieuDe: string; NguoiNhan: string | null; MaNguoiNhan: number | null; TenDonVi: string;
  TrangThaiPhanCong: number; NgayGiao: Date; HanHoanThanh: Date; TienDo: number; LanCapNhat: Date | null; SoCanBoSung: number; GiaHanCho: number;
}

export async function riskReport(db: SqlRunner, r: TaskRights, unitId: number | null): Promise<Result<RiskReportDto>> {
  const units = await db.query<{ MaDonVi: number; MaDonViCha: number | null; TenDonVi: string }>('SELECT MaDonVi, MaDonViCha, TenDonVi FROM dbo.DonVi;');
  const allowed = r.isAdmin ? new Set(units.map((u) => u.MaDonVi)) : r.viewUnits;
  if (allowed.size === 0) return fail(403, 'Chức vụ của bạn chưa có quyền xem phân tích của đơn vị.');
  let scope = [...allowed];
  let scopeLabel = `${allowed.size} đơn vị trong phạm vi`;
  if (unitId != null) {
    if (!allowed.has(unitId)) return fail(403, 'Đơn vị này ngoài phạm vi bạn được xem.');
    scope = [...subtree(units, unitId)].filter((u) => allowed.has(u));
    scopeLabel = (units.find((u) => u.MaDonVi === unitId)?.TenDonVi ?? '') + (scope.length > 1 ? ', gồm đơn vị trực thuộc' : '');
  }
  const rows = await db.query<RiskRow>(
    `SELECT p.MaPhanCong, p.MaCongViec, c.TieuDe, COALESCE(nn.HoTen, dn.TenDonVi) AS NguoiNhan, p.MaNguoiNhan, dv.TenDonVi,
            p.TrangThaiPhanCong, p.NgayGiao, p.HanHoanThanh, CAST(ISNULL(td.PhanTramTienDo, 0) AS FLOAT) AS TienDo, td.NgayCapNhat AS LanCapNhat,
            (SELECT COUNT(*) FROM dbo.DanhGia AS d JOIN dbo.KetQuaCongViec AS k ON k.MaKetQua = d.MaKetQua
              WHERE k.MaPhanCong = p.MaPhanCong AND d.QuyetDinh = 2) AS SoCanBoSung,
            (SELECT COUNT(*) FROM dbo.YeuCauGiaHan AS g WHERE g.MaPhanCong = p.MaPhanCong AND g.TrangThai = 0) AS GiaHanCho
     FROM dbo.PhanCong AS p
     JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
     JOIN dbo.DonVi AS dv ON dv.MaDonVi = c.MaDonViQuanLy
     LEFT JOIN dbo.NguoiDung AS nn ON nn.MaNguoiDung = p.MaNguoiNhan
     LEFT JOIN dbo.DonVi AS dn ON dn.MaDonVi = p.MaDonViNhan
     OUTER APPLY (SELECT TOP (1) x.PhanTramTienDo, x.NgayCapNhat FROM dbo.CapNhatTienDo AS x
                  WHERE x.MaPhanCong = p.MaPhanCong ORDER BY x.NgayCapNhat DESC, x.MaTienDo DESC) AS td
     WHERE p.TrangThaiPhanCong IN (0, 1, 2) AND c.TrangThai IN (1, 2, 3)
       AND p.HanHoanThanh >= SYSUTCDATETIME() AND c.MaDonViQuanLy IN @scope;`,
    { scope },
  );
  const people = [...new Set(rows.map((x) => x.MaNguoiNhan).filter((x): x is number => x != null))];
  // "Trễ": lần nộp Đạt (hoặc ngày hoàn thành) sau hạn hiện hành — cùng quy ước "đúng hạn" của thống kê.
  const history = new Map((await db.query<{ MaNguoiNhan: number; Xong: number; Tre: number }>(
    `SELECT p.MaNguoiNhan, COUNT(*) AS Xong,
            SUM(CASE WHEN COALESCE(k.NgayNopDat, p.NgayHoanThanh) > p.HanHoanThanh THEN 1 ELSE 0 END) AS Tre
     FROM dbo.PhanCong AS p
     OUTER APPLY (SELECT MAX(x.NgayNop) AS NgayNopDat FROM dbo.KetQuaCongViec AS x WHERE x.MaPhanCong = p.MaPhanCong AND x.TrangThaiNop = 1) AS k
     WHERE p.TrangThaiPhanCong = 4 AND p.MaNguoiNhan IN @people AND p.NgayHoanThanh >= DATEADD(DAY, -365, SYSUTCDATETIME())
     GROUP BY p.MaNguoiNhan;`,
    { people },
  )).map((x) => [x.MaNguoiNhan, x]));
  const load = new Map((await db.query<{ MaNguoiNhan: number; SoViec: number }>(
    `SELECT p.MaNguoiNhan, COUNT(*) AS SoViec FROM dbo.PhanCong AS p JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
     WHERE p.TrangThaiPhanCong IN (0, 1, 2) AND c.TrangThai IN (1, 2, 3) AND p.MaNguoiNhan IN @people GROUP BY p.MaNguoiNhan;`,
    { people },
  )).map((x) => [x.MaNguoiNhan, x.SoViec]));

  const now = nowUtc();
  const items: RiskItemDto[] = rows.map((x) => {
    const h = x.MaNguoiNhan != null ? history.get(x.MaNguoiNhan) : undefined;
    const progress = Math.round(Number(x.TienDo) || 0);
    const s = riskScore({
      status: x.TrangThaiPhanCong, assignedAt: x.NgayGiao, due: x.HanHoanThanh, progress, lastUpdate: x.LanCapNhat,
      needsWork: x.SoCanBoSung, pendingExtension: x.GiaHanCho > 0, doneLastYear: h?.Xong ?? 0, lateLastYear: h?.Tre ?? 0,
      openLoad: x.MaNguoiNhan != null ? load.get(x.MaNguoiNhan) ?? 0 : 0,
    }, now);
    return {
      assignmentId: x.MaPhanCong, taskId: x.MaCongViec, title: x.TieuDe, assignee: x.NguoiNhan ?? '', unitName: x.TenDonVi, due: iso(x.HanHoanThanh)!,
      daysLeft: s.daysLeft, progress, expectedProgress: s.expected, score: s.score, level: s.level, reasons: s.reasons,
    };
  }).sort((a, b) => b.score - a.score || a.daysLeft - b.daysLeft);
  const count = (l: RiskLevel) => items.filter((x) => x.level === l).length;
  return ok({ scopeLabel, high: count('high'), medium: count('medium'), low: count('low'), items });
}
