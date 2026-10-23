import type { CountItemDto, MonthItemDto, PendingItemDto, PersonStatDto, PersonalStatsDto, UnitStatDto, UnitStatsDto, AssignerStatsDto } from '@khoa/shared';
import type { SqlRunner } from '../db/db.service';
import { Result, fail, invalid, ok } from '../common/result';
import { initials } from '../common/text';
import { DAY_MS, OFFSET_MS, formatDate, iso, localDate, nowUtc, parseVnDate, toLocal, todayLocal, addMonths } from '../common/vn-time';
import { unitTypeLabel } from '../common/mapping';
import type { TaskRights } from './task-access';
import * as P from './task-policy';

/**
 * Thống kê. Quy ước:
 *  - Kỳ [from, to] theo ngày giờ Việt Nam; công việc/phân công thuộc kỳ khi được tạo/giao trước "to" và chưa xong hoặc xong sau "from".
 *    Không tính bản nháp và việc đã hủy.
 *  - "Đúng hạn": lần nộp được duyệt Đạt nộp trước hoặc đúng hạn hiện hành. Gia hạn đã duyệt làm thay đổi hạn hiện hành,
 *    nên xong trước hạn mới vẫn tính đúng hạn; số lần gia hạn được thống kê riêng.
 */
interface StatTaskRow { MaCongViec: number; TrangThai: number; HanHoanThanh: Date | null; NgayHoanThanh: Date | null; NgayXongViec: Date | null; MaDonViQuanLy: number; TenDonVi: string; }
interface StatAssignmentRow {
  MaPhanCong: number; MaCongViec: number; MaNguoiNhan: number | null; HoTen: string | null; TrangThaiPhanCong: number; NgayGiao: Date; HanHoanThanh: Date;
  NgayHoanThanh: Date | null; NgayNopDat: Date | null; VaiTro: number | null; SoDat: number; SoCanBoSung: number; SoKhongDat: number;
  TenTheLoai: string | null; MaDonViQuanLy: number; MaDonViGiao: number | null;
}
interface UnitLite { MaDonVi: number; MaDonViCha: number | null; TenDonVi: string; }

export function tryPeriod(fromText: string | null | undefined, toText: string | null | undefined): { from: Date; to: Date } | { error: string } {
  const today = todayLocal();
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1;
  // Mặc định: năm học hiện tại (01/08 – 31/07).
  const yearStart = new Date(Date.UTC(m >= 8 ? y : y - 1, 7, 1));
  const defaultFrom = formatDate(yearStart);
  const defaultTo = formatDate(new Date(addMonths(yearStart, 12).getTime() - DAY_MS));
  const from = parseVnDate(fromText && fromText.trim() ? fromText : defaultFrom, false);
  const to = parseVnDate(toText && toText.trim() ? toText : defaultTo, true);
  if (!from || !to) return { error: 'Ngày thống kê không hợp lệ.' };
  if (to < from) return { error: 'Ngày kết thúc phải sau ngày bắt đầu.' };
  if ((to.getTime() - from.getTime()) / DAY_MS > 3700) return { error: 'Kỳ thống kê tối đa 10 năm.' };
  return { from, to };
}

const percent = (part: number, total: number) => (total === 0 ? 0 : Math.round((100 * part) / total));

function subtree(units: UnitLite[], root: number): Set<number> {
  const set = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const u of units) if (u.MaDonViCha != null && set.has(u.MaDonViCha) && !set.has(u.MaDonVi)) { set.add(u.MaDonVi); changed = true; }
  }
  return set;
}

const ASSIGNMENT_STAT_SQL = `SELECT p.MaPhanCong, p.MaCongViec, p.MaNguoiNhan, n.HoTen, p.TrangThaiPhanCong, p.NgayGiao, p.HanHoanThanh, p.NgayHoanThanh,
       (SELECT MAX(k.NgayNop) FROM dbo.KetQuaCongViec AS k WHERE k.MaPhanCong = p.MaPhanCong AND k.TrangThaiNop = 1) AS NgayNopDat,
       p.VaiTro,
       -- Lượt duyệt tính theo NGÀY DUYỆT nằm trong kỳ (@from..@to), không cộng dồn mọi lần từ trước tới nay.
       (SELECT COUNT(*) FROM dbo.DanhGia AS d JOIN dbo.KetQuaCongViec AS k ON k.MaKetQua = d.MaKetQua
         WHERE k.MaPhanCong = p.MaPhanCong AND d.QuyetDinh = 1 AND d.NgayDanhGia BETWEEN @from AND @to) AS SoDat,
       (SELECT COUNT(*) FROM dbo.DanhGia AS d JOIN dbo.KetQuaCongViec AS k ON k.MaKetQua = d.MaKetQua
         WHERE k.MaPhanCong = p.MaPhanCong AND d.QuyetDinh = 2 AND d.NgayDanhGia BETWEEN @from AND @to) AS SoCanBoSung,
       (SELECT COUNT(*) FROM dbo.DanhGia AS d JOIN dbo.KetQuaCongViec AS k ON k.MaKetQua = d.MaKetQua
         WHERE k.MaPhanCong = p.MaPhanCong AND d.QuyetDinh = 3 AND d.NgayDanhGia BETWEEN @from AND @to) AS SoKhongDat,
       tl.TenTheLoai, c.MaDonViQuanLy, p.MaDonViGiao
FROM dbo.PhanCong AS p
JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
LEFT JOIN dbo.TheLoaiCongViec AS tl ON tl.MaTheLoai = c.MaTheLoai
LEFT JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = p.MaNguoiNhan`;

function onTime(a: StatAssignmentRow): boolean {
  const done = a.NgayNopDat ?? a.NgayHoanThanh;
  return a.TrangThaiPhanCong === P.AsDone && done != null && done <= a.HanHoanThanh;
}

/**
 * Các tháng của biểu đồ "giao / hoàn thành theo tháng": từ tháng đầu kỳ tới tháng hiện tại
 * (hoặc tháng cuối kỳ nếu kỳ đã qua), tối đa 12 tháng gần nhất. Cùng một kỳ luôn ra cùng các tháng,
 * không còn hiện các tháng chưa tới (trước đây: 6 tháng tính lùi từ cuối kỳ).
 */
function monthRange(from: Date, to: Date, now: Date): { start: Date; end: Date; keys: Date[] } {
  const end = to < now ? to : now < from ? from : now;
  const monthOf = (d: Date) => { const l = toLocal(d); return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1)); };
  const last = monthOf(end);
  let first = monthOf(from);
  if (first < addMonths(last, -11)) first = addMonths(last, -11);
  const keys: Date[] = [];
  for (let k = first; k <= last; k = addMonths(k, 1)) keys.push(k);
  return { start: new Date(first.getTime() - OFFSET_MS), end, keys };
}

function months(keys: Date[], assigned: Date[], completed: (Date | null)[]): MonthItemDto[] {
  const key = (utc: Date) => toLocal(utc).toISOString().slice(0, 7);
  const count = (list: Date[]) => list.reduce((m, d) => m.set(key(d), (m.get(key(d)) ?? 0) + 1), new Map<string, number>());
  const a = count(assigned), c = count(completed.filter((d): d is Date => d != null));
  return keys.map((k) => {
    const month = k.toISOString().slice(0, 7);
    return { month, assigned: a.get(month) ?? 0, completed: c.get(month) ?? 0 };
  });
}

// ---------------- Thống kê đơn vị ----------------
export async function unitStats(db: SqlRunner, r: TaskRights, fromText: string | null, toText: string | null, unitId: number | null, categoryId: number | null): Promise<Result<UnitStatsDto>> {
  const period = tryPeriod(fromText, toText);
  if ('error' in period) return invalid({ from: period.error });
  const { from, to } = period;
  const units = await db.query<UnitLite>('SELECT MaDonVi, MaDonViCha, TenDonVi FROM dbo.DonVi;');
  const allowed = r.isAdmin ? new Set(units.map((u) => u.MaDonVi)) : r.viewUnits;
  if (allowed.size === 0) return fail(403, 'Chức vụ của bạn chưa có quyền xem thống kê đơn vị.');
  let scope: Set<number>;
  let label: string;
  if (unitId != null) {
    if (!allowed.has(unitId)) return fail(403, 'Đơn vị này ngoài phạm vi bạn được xem.');
    scope = new Set([...subtree(units, unitId)].filter((u) => allowed.has(u)));
    label = (units.find((x) => x.MaDonVi === unitId)?.TenDonVi ?? '') + (scope.size > 1 ? ', gồm đơn vị trực thuộc' : '');
  } else {
    scope = new Set(allowed);
    const roots = units.filter((x) => scope.has(x.MaDonVi) && (x.MaDonViCha == null || !scope.has(x.MaDonViCha)));
    label = roots.length === 1 ? roots[0].TenDonVi + (scope.size > 1 ? ', gồm đơn vị trực thuộc' : '') : `${scope.size} đơn vị trong phạm vi`;
  }
  const scopeList = [...scope];
  const tasks = await db.query<StatTaskRow>(
    `SELECT cv.MaCongViec, cv.TrangThai, cv.HanHoanThanh, cv.NgayHoanThanh,
            (SELECT MAX(k.NgayNop) FROM dbo.KetQuaCongViec AS k JOIN dbo.PhanCong AS p ON p.MaPhanCong = k.MaPhanCong
              WHERE p.MaCongViec = cv.MaCongViec AND k.TrangThaiNop = 1) AS NgayXongViec,
            cv.MaDonViQuanLy, dv.TenDonVi
     FROM dbo.CongViec AS cv JOIN dbo.DonVi AS dv ON dv.MaDonVi = cv.MaDonViQuanLy
     WHERE cv.TrangThai NOT IN (0, 6) AND cv.MaDonViQuanLy IN @scope
       AND (@categoryId IS NULL OR cv.MaTheLoai = @categoryId)
       AND cv.NgayTao <= @to AND (cv.NgayHoanThanh IS NULL OR cv.NgayHoanThanh >= @from);`,
    { scope: scopeList, categoryId, from, to },
  );
  const now = nowUtc();
  const taskOnTime = (t: StatTaskRow) => {
    const done = t.NgayXongViec ?? t.NgayHoanThanh;
    return t.TrangThai === P.Done && t.HanHoanThanh != null && done != null && done <= t.HanHoanThanh;
  };
  const taskOverdue = (t: StatTaskRow) => P.isOverdue(t.HanHoanThanh, t.TrangThai, now);
  const completed = tasks.filter((t) => t.TrangThai === P.Done).length;
  const onTimeCount = tasks.filter(taskOnTime).length;

  const assignments = await db.query<StatAssignmentRow>(
    `${ASSIGNMENT_STAT_SQL}
     WHERE c.TrangThai NOT IN (0, 6) AND p.TrangThaiPhanCong NOT IN (5, 6) AND c.MaDonViQuanLy IN @scope
       AND (@categoryId IS NULL OR c.MaTheLoai = @categoryId)
       AND p.NgayGiao <= @to AND (p.NgayHoanThanh IS NULL OR p.NgayHoanThanh >= @from);`,
    { scope: scopeList, categoryId, from, to },
  );
  const range = monthRange(from, to, now);
  const monthTasks = await db.query<{ NgayTao: Date; NgayHoanThanh: Date | null }>(
    `SELECT cv.NgayTao, cv.NgayHoanThanh FROM dbo.CongViec AS cv
     WHERE cv.TrangThai NOT IN (0, 6) AND cv.MaDonViQuanLy IN @scope AND (@categoryId IS NULL OR cv.MaTheLoai = @categoryId)
       AND (cv.NgayTao >= @mFrom OR cv.NgayHoanThanh >= @mFrom);`,
    { scope: scopeList, categoryId, mFrom: range.start },
  );
  const inWindow = (d: Date | null) => d != null && d >= range.start && d <= range.end;
  // NgayHoanThanh có thể nằm ở tương lai (CSDL buộc >= NgayBatDau khi đóng việc trước ngày bắt đầu): tính là hôm nay.
  const doneAt = (d: Date | null) => (d && d > now ? now : d);
  const byMonth = months(range.keys, monthTasks.map((x) => x.NgayTao).filter(inWindow), monthTasks.map((x) => doneAt(x.NgayHoanThanh)).filter(inWindow));

  const byStatus: CountItemDto[] = [
    { key: 'done', label: 'Hoàn thành', value: completed },
    { key: 'doing', label: 'Đang thực hiện', value: tasks.filter((t) => t.TrangThai === P.InProgress).length },
    { key: 'review', label: 'Chờ duyệt', value: tasks.filter((t) => t.TrangThai === P.Review).length },
    { key: 'new', label: 'Chưa bắt đầu', value: tasks.filter((t) => t.TrangThai === P.NotStarted).length },
    { key: 'paused', label: 'Tạm dừng', value: tasks.filter((t) => t.TrangThai === P.Paused).length },
  ];
  const groups = new Map<number, StatTaskRow[]>();
  for (const t of tasks) groups.set(t.MaDonViQuanLy, [...(groups.get(t.MaDonViQuanLy) ?? []), t]);
  const byUnit: UnitStatDto[] = [...groups.values()].map((g) => {
    const done = g.filter((t) => t.TrangThai === P.Done).length;
    return { unitId: g[0].MaDonViQuanLy, unitName: g[0].TenDonVi, total: g.length, open: g.length - done, completed: done, overdue: g.filter(taskOverdue).length, onTimePercent: percent(g.filter(taskOnTime).length, done) };
  }).sort((a, b) => b.total - a.total);

  const primaryUnits = new Map((await db.query<{ MaNguoiDung: number; TenDonVi: string }>(
    `SELECT tv.MaNguoiDung, MIN(d.TenDonVi) AS TenDonVi FROM dbo.ThanhVienDonVi AS tv JOIN dbo.DonVi AS d ON d.MaDonVi = tv.MaDonVi
     WHERE tv.LaDonViChinh = 1 AND tv.TrangThai = 1 GROUP BY tv.MaNguoiDung;`,
  )).map((x) => [x.MaNguoiDung, x.TenDonVi]));
  const byPersonMap = new Map<number, StatAssignmentRow[]>();
  for (const a of assignments) if (a.MaNguoiNhan != null) byPersonMap.set(a.MaNguoiNhan, [...(byPersonMap.get(a.MaNguoiNhan) ?? []), a]);
  const byPerson: PersonStatDto[] = [...byPersonMap.entries()].map(([pid, g]) => {
    const done = g.filter((a) => a.TrangThaiPhanCong === P.AsDone).length;
    const name = g[0].HoTen ?? '';
    const onTimeDone = g.filter(onTime).length;
    return {
      personId: pid, name, initials: initials(name), unitName: primaryUnits.get(pid) ?? '', assigned: g.length, completed: done,
      onTimePercent: percent(onTimeDone, done), overdue: g.filter((a) => P.isOpenStatus(a.TrangThaiPhanCong) && a.HanHoanThanh < now).length,
      passed: g.reduce((s, a) => s + a.SoDat, 0),
      lead: g.filter((a) => a.VaiTro === 1).length, support: g.filter((a) => a.VaiTro === 2).length,
      inProgress: g.filter((a) => a.TrangThaiPhanCong === P.AsWaiting || a.TrangThaiPhanCong === P.AsAccepted || a.TrangThaiPhanCong === P.AsWorking).length,
      waitingReview: g.filter((a) => a.TrangThaiPhanCong === P.AsReview).length, late: done - onTimeDone,
      needsWork: g.reduce((s, a) => s + a.SoCanBoSung, 0), failed: g.reduce((s, a) => s + a.SoKhongDat, 0),
    };
  });
  // Thành viên đang hoạt động của các đơn vị trong phạm vi nhưng chưa có phân công cá nhân trong kỳ: vẫn liệt kê (số 0)
  // để thống kê đủ từng giảng viên, không chỉ người đang có việc.
  const idle = await db.query<{ MaNguoiDung: number; HoTen: string }>(
    `SELECT DISTINCT n.MaNguoiDung, n.HoTen
     FROM dbo.ThanhVienDonVi AS tv JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = tv.MaNguoiDung
     WHERE tv.MaDonVi IN @scope AND tv.TrangThai = 1 AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= CAST(SYSUTCDATETIME() AS DATE))
       AND n.TrangThaiTaiKhoan = 1;`,
    { scope: scopeList },
  );
  for (const p of idle) {
    if (byPersonMap.has(p.MaNguoiDung)) continue;
    byPerson.push({
      personId: p.MaNguoiDung, name: p.HoTen, initials: initials(p.HoTen), unitName: primaryUnits.get(p.MaNguoiDung) ?? '', assigned: 0, completed: 0,
      onTimePercent: 0, overdue: 0, passed: 0, lead: 0, support: 0, inProgress: 0, waitingReview: 0, late: 0, needsWork: 0, failed: 0,
    });
  }
  byPerson.sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name, 'vi'));

  return ok({
    from: localDate(from), to: localDate(to), scopeLabel: label, total: tasks.length, open: tasks.length - completed, completed,
    onTimePercent: percent(onTimeCount, completed), onTimeCount, overdue: tasks.filter(taskOverdue).length,
    passed: assignments.reduce((s, a) => s + a.SoDat, 0), needsWork: assignments.reduce((s, a) => s + a.SoCanBoSung, 0), failed: assignments.reduce((s, a) => s + a.SoKhongDat, 0),
    byStatus, byMonth, byUnit, byPerson,
  });
}

// ---------------- Thống kê cá nhân ----------------
interface MembershipStatRow { MaDonVi: number; TenDonVi: string; LoaiDonVi: string; TenChucVu: string; NgayThamGia: Date; NgayKetThuc: Date | null; LaDonViChinh: boolean; DangHieuLuc: number; }

export async function personalStats(db: SqlRunner, r: TaskRights, personId: number, fromText: string | null, toText: string | null): Promise<Result<PersonalStatsDto>> {
  const period = tryPeriod(fromText, toText);
  if ('error' in period) return invalid({ from: period.error });
  const { from, to } = period;
  const person = await db.one<{ MaNguoiDung: number; HoTen: string }>('SELECT MaNguoiDung, HoTen FROM dbo.NguoiDung WHERE MaNguoiDung = @personId;', { personId });
  if (!person) return fail(404, 'Không tìm thấy người dùng.');
  const memberships = await db.query<MembershipStatRow>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT tv.MaDonVi, d.TenDonVi, d.LoaiDonVi, c.TenChucVu, tv.NgayThamGia, tv.NgayKetThuc, tv.LaDonViChinh,
            CASE WHEN tv.TrangThai = 1 AND d.TrangThai = 1 AND tv.NgayThamGia <= @HomNay
                      AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay) THEN 1 ELSE 0 END AS DangHieuLuc
     FROM dbo.ThanhVienDonVi AS tv
     JOIN dbo.DonVi AS d ON d.MaDonVi = tv.MaDonVi
     JOIN dbo.ChucVu AS c ON c.MaChucVu = tv.MaChucVu
     WHERE tv.MaNguoiDung = @personId
     ORDER BY DangHieuLuc DESC, tv.LaDonViChinh DESC, d.TenDonVi;`,
    { personId },
  );
  // Người khác chỉ xem được khi là quản trị hoặc quản lý một đơn vị người đó đang thuộc.
  if (personId !== r.userId && !r.isAdmin && !memberships.some((m) => m.DangHieuLuc === 1 && r.viewUnits.has(m.MaDonVi)))
    return fail(403, 'Bạn chỉ xem được thống kê của người trong đơn vị mình quản lý.');

  const now = nowUtc();
  const mine = await db.query<StatAssignmentRow>(
    `${ASSIGNMENT_STAT_SQL}
     WHERE p.MaNguoiNhan = @personId AND c.TrangThai NOT IN (0, 6) AND p.TrangThaiPhanCong NOT IN (5, 6)
       AND p.NgayGiao <= @to AND (p.NgayHoanThanh IS NULL OR p.NgayHoanThanh >= @from);`,
    { personId, from, to },
  );
  const completed = mine.filter((a) => a.TrangThaiPhanCong === P.AsDone).length;
  const onTimeCount = mine.filter(onTime).length;
  const ext = (await db.one<{ Tong: number; DaDuyet: number }>(
    `SELECT COUNT(*) AS Tong, ISNULL(SUM(CASE WHEN TrangThai IN (1, 2) THEN 1 ELSE 0 END), 0) AS DaDuyet
     FROM dbo.YeuCauGiaHan WHERE MaNguoiYeuCau = @personId AND NgayTao BETWEEN @from AND @to;`,
    { personId, from, to },
  ))!;
  const monthsRange = monthRange(from, to, now);
  const monthRows = await db.query<{ NgayGiao: Date; NgayHoanThanh: Date | null }>(
    `SELECT p.NgayGiao, p.NgayHoanThanh FROM dbo.PhanCong AS p JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
     WHERE p.MaNguoiNhan = @personId AND p.TrangThaiPhanCong NOT IN (5, 6) AND c.TrangThai NOT IN (0, 6)
       AND (p.NgayGiao >= @mFrom OR p.NgayHoanThanh >= @mFrom);`,
    { personId, mFrom: monthsRange.start },
  );
  const inWindow = (d: Date | null) => d != null && d >= monthsRange.start && d <= monthsRange.end;
  const byMonth = months(monthsRange.keys, monthRows.map((x) => x.NgayGiao).filter(inWindow), monthRows.map((x) => (x.NgayHoanThanh && x.NgayHoanThanh > now ? now : x.NgayHoanThanh)).filter(inWindow));
  const catMap = new Map<string, number>();
  for (const a of mine) {
    const k = a.TenTheLoai && a.TenTheLoai.trim() ? a.TenTheLoai : 'Chưa phân loại';
    catMap.set(k, (catMap.get(k) ?? 0) + 1);
  }
  const byCategory: CountItemDto[] = [...catMap.entries()].map(([k, v]) => ({ key: k, label: k, value: v })).sort((a, b) => b.value - a.value);

  // Trung bình đúng hạn của đơn vị chính (gộp, không lộ từng người).
  let unitAverageOnTime: number | null = null;
  const primary = memberships.find((m) => m.DangHieuLuc === 1 && m.LaDonViChinh);
  if (primary) {
    const unitRows = await db.query<StatAssignmentRow>(
      `${ASSIGNMENT_STAT_SQL}
       WHERE p.TrangThaiPhanCong = 4 AND c.TrangThai NOT IN (0, 6)
         AND p.NgayHoanThanh BETWEEN @from AND @to
         AND p.MaNguoiNhan IN (SELECT tv.MaNguoiDung FROM dbo.ThanhVienDonVi AS tv WHERE tv.MaDonVi = @unitId AND tv.TrangThai = 1);`,
      { from, to, unitId: primary.MaDonVi },
    );
    if (unitRows.length > 0) unitAverageOnTime = percent(unitRows.filter(onTime).length, unitRows.length);
  }

  let asAssigner: AssignerStatsDto | null = null;
  const given = await db.query<StatAssignmentRow>(
    `${ASSIGNMENT_STAT_SQL}
     WHERE p.MaNguoiGiao = @personId AND c.TrangThai NOT IN (0, 6) AND p.TrangThaiPhanCong NOT IN (5, 6)
       AND p.NgayGiao <= @to AND (p.NgayHoanThanh IS NULL OR p.NgayHoanThanh >= @from);`,
    { personId, from, to },
  );
  const isManagerSelf = personId === r.userId && r.assignUnits.size > 0;
  if (given.length > 0 || isManagerSelf) {
    const pending = await db.query<{ Kind: string; MaCongViec: number; TieuDe: string; Who: string; Since: Date }>(
      `SELECT N'result' AS Kind, c.MaCongViec, c.TieuDe, COALESCE(nn.HoTen, dn.TenDonVi) AS Who, k.NgayNop AS Since
       FROM dbo.KetQuaCongViec AS k
       JOIN dbo.PhanCong AS p ON p.MaPhanCong = k.MaPhanCong
       JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
       LEFT JOIN dbo.NguoiDung AS nn ON nn.MaNguoiDung = p.MaNguoiNhan
       LEFT JOIN dbo.DonVi AS dn ON dn.MaDonVi = p.MaDonViNhan
       WHERE p.MaNguoiGiao = @personId AND k.TrangThaiNop = 0 AND p.TrangThaiPhanCong = 3 AND c.TrangThai IN (1, 2, 3)
       UNION ALL
       SELECT N'extension', c.MaCongViec, c.TieuDe, ny.HoTen, g.NgayTao
       FROM dbo.YeuCauGiaHan AS g
       JOIN dbo.PhanCong AS p ON p.MaPhanCong = g.MaPhanCong
       JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
       JOIN dbo.NguoiDung AS ny ON ny.MaNguoiDung = g.MaNguoiYeuCau
       WHERE p.MaNguoiGiao = @personId AND g.TrangThai = 0 AND c.TrangThai IN (1, 2, 3)
       UNION ALL
       SELECT N'accept', c.MaCongViec, c.TieuDe, COALESCE(nn.HoTen, dn.TenDonVi), p.NgayGiao
       FROM dbo.PhanCong AS p
       JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
       LEFT JOIN dbo.NguoiDung AS nn ON nn.MaNguoiDung = p.MaNguoiNhan
       LEFT JOIN dbo.DonVi AS dn ON dn.MaDonVi = p.MaDonViNhan
       WHERE p.MaNguoiGiao = @personId AND p.TrangThaiPhanCong = 0 AND c.TrangThai IN (1, 2, 3);`,
      { personId },
    );
    const reviewHours = await db.scalar<number>(
      `SELECT AVG(CAST(DATEDIFF(MINUTE, k.NgayNop, d.NgayDanhGia) AS FLOAT)) / 60.0
       FROM dbo.DanhGia AS d JOIN dbo.KetQuaCongViec AS k ON k.MaKetQua = d.MaKetQua
       WHERE d.MaNguoiDanhGia = @personId AND d.NgayDanhGia BETWEEN @from AND @to;`,
      { personId, from, to },
    );
    const late = given.filter((a) => (a.TrangThaiPhanCong === P.AsDone && !onTime(a)) || (P.isOpenStatus(a.TrangThaiPhanCong) && a.HanHoanThanh < now)).length;
    const items: PendingItemDto[] = pending
      .map((p) => ({ kind: p.Kind as PendingItemDto['kind'], taskId: p.MaCongViec, title: p.TieuDe, who: p.Who, since: iso(p.Since)!, waitingDays: Math.max(0, Math.floor((now.getTime() - p.Since.getTime()) / DAY_MS)) }))
      .sort((a, b) => b.waitingDays - a.waitingDays || Date.parse(a.since) - Date.parse(b.since));
    asAssigner = {
      assigned: given.length, pendingTotal: items.length, pendingResults: items.filter((x) => x.kind === 'result').length,
      pendingExtensions: items.filter((x) => x.kind === 'extension').length, pendingAccept: items.filter((x) => x.kind === 'accept').length,
      averageReviewDays: reviewHours == null ? null : Math.round((reviewHours / 24) * 10) / 10, late, pending: items,
    };
  }

  const openByUnit = new Map((await db.query<{ MaDonVi: number; SoViec: number }>(
    `SELECT x.MaDonVi, COUNT(DISTINCT x.MaPhanCong) AS SoViec
     FROM (
         SELECT p.MaPhanCong, c.MaDonViQuanLy AS MaDonVi FROM dbo.PhanCong AS p JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
         WHERE p.MaNguoiNhan = @personId AND p.TrangThaiPhanCong IN (0, 1, 2, 3) AND c.TrangThai IN (1, 2, 3, 5)
         UNION ALL
         SELECT p.MaPhanCong, p.MaDonViGiao FROM dbo.PhanCong AS p JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
         WHERE p.MaNguoiNhan = @personId AND p.MaDonViGiao IS NOT NULL AND p.TrangThaiPhanCong IN (0, 1, 2, 3) AND c.TrangThai IN (1, 2, 3, 5)
     ) AS x
     GROUP BY x.MaDonVi;`,
    { personId },
  )).map((x) => [x.MaDonVi, x.SoViec]));
  const membershipDtos = memberships.map((m) => ({
    unitId: m.MaDonVi, unitName: m.TenDonVi, unitType: unitTypeLabel(m.LoaiDonVi), role: m.TenChucVu, start: formatDate(m.NgayThamGia),
    end: m.NgayKetThuc ? formatDate(m.NgayKetThuc) : null, primary: !!m.LaDonViChinh, ended: m.DangHieuLuc !== 1, openTasks: openByUnit.get(m.MaDonVi) ?? 0,
  }));
  const current = memberships.filter((m) => m.DangHieuLuc === 1);
  const subtitle = current.length === 0 ? 'Chưa thuộc đơn vị nào'
    : [[...new Set(current.map((m) => m.TenChucVu))].slice(0, 2).join(', '), (primary ?? current[0]).TenDonVi].join(' · ');

  return ok({
    from: localDate(from), to: localDate(to), person: { id: person.MaNguoiDung, name: person.HoTen, initials: initials(person.HoTen) }, subtitle,
    assigned: mine.length, lead: mine.filter((a) => a.VaiTro === 1).length, support: mine.filter((a) => a.VaiTro === 2).length,
    completed, onTimePercent: percent(onTimeCount, completed), onTimeCount,
    open: mine.filter((a) => P.isOpenStatus(a.TrangThaiPhanCong) || a.TrangThaiPhanCong === P.AsReview).length,
    dueSoon: mine.filter((a) => P.isOpenStatus(a.TrangThaiPhanCong) && a.HanHoanThanh >= now && a.HanHoanThanh.getTime() <= now.getTime() + P.DUE_SOON_DAYS * DAY_MS).length,
    waitingReview: mine.filter((a) => a.TrangThaiPhanCong === P.AsReview).length,
    passed: mine.reduce((s, a) => s + a.SoDat, 0), needsWork: mine.reduce((s, a) => s + a.SoCanBoSung, 0), extensions: ext.Tong,
    unitAverageOnTime, byMonth, byCategory, asAssigner, memberships: membershipDtos,
    overdue: mine.filter((a) => P.isOpenStatus(a.TrangThaiPhanCong) && a.HanHoanThanh < now).length,
    failed: mine.reduce((s, a) => s + a.SoKhongDat, 0),
    approvedExtensions: ext.DaDuyet,
    unitName: primary?.TenDonVi ?? null,
  });
}
