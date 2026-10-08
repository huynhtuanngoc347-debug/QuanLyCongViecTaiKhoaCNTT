import type { TaskCapabilitiesDto } from '@khoa/shared';
import type { SqlRunner } from '../db/db.service';

/**
 * Quyền nghiệp vụ của một người trong phân hệ Công việc, tính lại từ CSDL ở mỗi yêu cầu:
 *  - chỉ tính chức vụ còn hiệu lực (thành viên, chức vụ, đơn vị đang hoạt động; hôm nay trong NgayThamGia..NgayKetThuc),
 *  - quyền ở một đơn vị áp dụng thêm cho đơn vị con cháu khi chức vụ có ApDungChoDonViCon,
 *  - LaQuanTriHeThong chỉ cho XEM toàn bộ (chỉ đọc), không tự cấp quyền giao/duyệt nghiệp vụ.
 */
export class TaskRights {
  readonly memberUnits = new Set<number>();
  readonly createUnits = new Set<number>();
  readonly assignUnits = new Set<number>();
  /** Đơn vị mà chính người này giữ chức vụ có quyền giao việc (không tính đơn vị con): người tiếp nhận việc giao cho cả đơn vị. */
  readonly directAssignUnits = new Set<number>();
  readonly reviewUnits = new Set<number>();
  readonly reportUnits = new Set<number>();

  constructor(public readonly userId: number, public readonly userName: string, public readonly isAdmin: boolean) {}

  /** Đơn vị được xem toàn bộ công việc (phạm vi quản lý). */
  get viewUnits(): Set<number> {
    return new Set([...this.createUnits, ...this.assignUnits, ...this.reviewUnits, ...this.reportUnits]);
  }

  canSeeUnit(unitId: number): boolean {
    return this.isAdmin || this.viewUnits.has(unitId);
  }

  toDto(): TaskCapabilitiesDto {
    const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
    return {
      createUnitIds: sorted(this.createUnits),
      assignUnitIds: sorted(this.assignUnits),
      reviewUnitIds: sorted(this.reviewUnits),
      reportUnitIds: sorted(this.reportUnits),
      isMember: this.memberUnits.size > 0,
    };
  }
}

interface RightRow {
  MaDonVi: number; DuocTaoCongViec: boolean; DuocGiaoViec: boolean; DuocDuyetKetQua: boolean;
  DuocDanhGia: boolean; DuocXemBaoCaoDonVi: boolean; ApDungChoDonViCon: boolean;
}

/** Trả null nếu tài khoản không còn hoạt động. */
export async function loadRights(db: SqlRunner, userId: number): Promise<TaskRights | null> {
  const user = await db.one<{ HoTen: string; LaQuanTriHeThong: boolean }>(
    'SELECT HoTen, LaQuanTriHeThong FROM dbo.NguoiDung WHERE MaNguoiDung = @userId AND TrangThaiTaiKhoan = 1;',
    { userId },
  );
  if (!user) return null;
  const rows = await db.query<RightRow>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT tv.MaDonVi, c.DuocTaoCongViec, c.DuocGiaoViec, c.DuocDuyetKetQua, c.DuocDanhGia,
            c.DuocXemBaoCaoDonVi, c.ApDungChoDonViCon
     FROM dbo.ThanhVienDonVi AS tv
     JOIN dbo.ChucVu AS c ON c.MaChucVu = tv.MaChucVu
     JOIN dbo.DonVi AS dv ON dv.MaDonVi = tv.MaDonVi
     WHERE tv.MaNguoiDung = @userId
       AND tv.TrangThai = 1 AND c.TrangThai = 1 AND dv.TrangThai = 1
       AND tv.NgayThamGia <= @HomNay
       AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay);`,
    { userId },
  );
  const rights = new TaskRights(userId, user.HoTen, !!user.LaQuanTriHeThong);
  if (rows.length === 0) return rights;

  const links = await db.query<{ MaDonVi: number; MaDonViCha: number | null }>('SELECT MaDonVi, MaDonViCha FROM dbo.DonVi WHERE TrangThai = 1;');
  const children = new Map<number, number[]>();
  for (const l of links) {
    if (l.MaDonViCha == null) continue;
    const list = children.get(l.MaDonViCha) ?? [];
    list.push(l.MaDonVi);
    children.set(l.MaDonViCha, list);
  }
  const expand = (unitId: number, withChildren: boolean): number[] => {
    const out = [unitId];
    if (!withChildren) return out;
    const seen = new Set([unitId]);
    const queue = [unitId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const kid of children.get(current) ?? []) {
        if (seen.has(kid)) continue;
        seen.add(kid);
        queue.push(kid);
        out.push(kid);
      }
    }
    return out;
  };
  for (const r of rows) {
    rights.memberUnits.add(r.MaDonVi);
    const scope = expand(r.MaDonVi, !!r.ApDungChoDonViCon);
    if (r.DuocTaoCongViec) scope.forEach((u) => rights.createUnits.add(u));
    if (r.DuocGiaoViec) {
      scope.forEach((u) => rights.assignUnits.add(u));
      rights.directAssignUnits.add(r.MaDonVi);
    }
    if (r.DuocDuyetKetQua || r.DuocDanhGia) scope.forEach((u) => rights.reviewUnits.add(u));
    if (r.DuocXemBaoCaoDonVi) scope.forEach((u) => rights.reportUnits.add(u));
  }
  return rights;
}

/** Những người đang giữ quyền giao việc tại một đơn vị (nhận thông báo khi giao cho cả đơn vị). */
export async function unitManagers(db: SqlRunner, unitId: number): Promise<number[]> {
  const rows = await db.query<{ MaNguoiDung: number }>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT DISTINCT tv.MaNguoiDung
     FROM dbo.ThanhVienDonVi AS tv
     JOIN dbo.ChucVu AS c ON c.MaChucVu = tv.MaChucVu
     JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = tv.MaNguoiDung
     WHERE tv.MaDonVi = @unitId AND c.DuocGiaoViec = 1
       AND tv.TrangThai = 1 AND c.TrangThai = 1 AND n.TrangThaiTaiKhoan = 1
       AND tv.NgayThamGia <= @HomNay
       AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay);`,
    { unitId },
  );
  return rows.map((r) => r.MaNguoiDung);
}
