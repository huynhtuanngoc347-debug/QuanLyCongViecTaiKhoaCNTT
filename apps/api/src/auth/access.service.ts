import type { CapabilitiesDto, PortalDto } from '@khoa/shared';
import type { SqlRunner } from '../db/db.service';
import { PERSON_COLUMNS, type PersonRow } from '../common/mapping';
import { normalize } from '../common/text';

/**
 * Kiểm tra quyền phía máy chủ theo quy tắc của KhoaCNTT_chinhlan1.sql:
 *  - chức vụ còn hiệu lực (TrangThai, NgayThamGia..NgayKetThuc tính cả ngày cuối),
 *  - phạm vi đơn vị và ApDungChoDonViCon,
 *  - LaQuanTriHeThong chỉ dùng cho quản trị cấu trúc, không tự cấp quyền duyệt nghiệp vụ.
 * Cờ quản trị luôn đọc lại từ CSDL cho mỗi yêu cầu.
 */
export function loadActiveUser(db: SqlRunner, userId: number): Promise<PersonRow | null> {
  return db.one<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM dbo.NguoiDung WHERE MaNguoiDung = @userId AND TrangThaiTaiKhoan = 1;`, { userId });
}

/** Đơn vị người dùng được thêm thành viên (DuocQuanLyThanhVien + đơn vị con nếu ApDungChoDonViCon). Quản trị: mọi đơn vị. */
export async function manageableUnitIds(db: SqlRunner, user: PersonRow): Promise<number[]> {
  if (user.LaQuanTriHeThong) {
    return (await db.query<{ MaDonVi: number }>('SELECT MaDonVi FROM dbo.DonVi;')).map((r) => r.MaDonVi);
  }
  const rows = await db.query<{ MaDonVi: number }>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     WITH QuyenGoc AS (
         SELECT tv.MaDonVi, c.ApDungChoDonViCon
         FROM dbo.ThanhVienDonVi AS tv
         JOIN dbo.ChucVu AS c ON c.MaChucVu = tv.MaChucVu
         JOIN dbo.DonVi AS dv ON dv.MaDonVi = tv.MaDonVi
         WHERE tv.MaNguoiDung = @userId
           AND tv.TrangThai = 1 AND c.TrangThai = 1 AND dv.TrangThai = 1
           AND c.DuocQuanLyThanhVien = 1
           AND tv.NgayThamGia <= @HomNay
           AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay)
     ),
     PhamVi AS (
         SELECT MaDonVi, ApDungChoDonViCon, 0 AS Cap FROM QuyenGoc
         UNION ALL
         SELECT d.MaDonVi, p.ApDungChoDonViCon, p.Cap + 1
         FROM dbo.DonVi AS d
         JOIN PhamVi AS p ON d.MaDonViCha = p.MaDonVi
         WHERE p.ApDungChoDonViCon = 1 AND p.Cap < 50
     )
     SELECT DISTINCT MaDonVi FROM PhamVi
     OPTION (MAXRECURSION 100);`,
    { userId: user.MaNguoiDung },
  );
  return rows.map((r) => r.MaDonVi);
}

export async function capabilities(db: SqlRunner, user: PersonRow): Promise<CapabilitiesDto> {
  const manageable = await manageableUnitIds(db, user);
  // Tạo đơn vị và cấu hình quyền chức vụ là quản trị cấu trúc: chỉ quản trị hệ thống.
  return { canCreateUnit: !!user.LaQuanTriHeThong, canEditRoles: !!user.LaQuanTriHeThong, manageableUnitIds: manageable };
}

// ================= TRANG THEO VAI TRÒ =================
export const PORTAL_KEYS = ['admin', 'truong-khoa', 'truong-bo-mon', 'ca-nhan'] as const;
const DEPARTMENT_HEAD_ROLES = ['truong bo mon', 'pho truong bo mon', 'phu trach bo mon'];
const distinct = <T>(items: T[]): T[] => [...new Set(items)];

/**
 * Trang theo vai trò (phần tử đầu là trang mở sau khi đăng nhập):
 *  admin (LaQuanTriHeThong), ca-nhan (mọi người có đơn vị, hoặc khi không có trang nào khác).
 * Trang Trưởng khoa / Trang bộ môn đã gộp vào Trang cá nhân: nhãn vai trò liệt kê mọi chức vụ,
 * bảng điều khiển tự hiện phần "Việc tôi quản lý" theo quyền giao việc/xem báo cáo.
 */
export async function portals(db: SqlRunner, user: PersonRow): Promise<PortalDto[]> {
  const roles = await db.query<{ TenChucVu: string; LoaiDonVi: string; TenDonVi: string }>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT c.TenChucVu, dv.LoaiDonVi, dv.TenDonVi
     FROM dbo.ThanhVienDonVi AS tv
     JOIN dbo.ChucVu AS c ON c.MaChucVu = tv.MaChucVu
     JOIN dbo.DonVi AS dv ON dv.MaDonVi = tv.MaDonVi
     WHERE tv.MaNguoiDung = @userId
       AND tv.TrangThai = 1 AND c.TrangThai = 1 AND dv.TrangThai = 1
       AND tv.NgayThamGia <= @HomNay
       AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay)
     ORDER BY tv.LaDonViChinh DESC, dv.TenDonVi;`,
    { userId: user.MaNguoiDung },
  );
  const result: PortalDto[] = [];
  if (user.LaQuanTriHeThong) {
    result.push({ key: 'admin', roleLabel: 'Quản trị hệ thống', title: 'Trang quản trị', scope: 'Quản lý tài khoản, cơ cấu tổ chức, chức vụ và quyền.' });
  }
  if (roles.length > 0 || result.length === 0) {
    // Chức vụ lãnh đạo (Trưởng khoa, Trưởng/Phó/Phụ trách bộ môn) đứng trước trong nhãn vai trò.
    const leader = (r: { TenChucVu: string; LoaiDonVi: string }) =>
      (normalize(r.TenChucVu) === 'truong khoa' && r.LoaiDonVi === 'Khoa') || DEPARTMENT_HEAD_ROLES.includes(normalize(r.TenChucVu));
    const ordered = [...roles.filter(leader), ...roles.filter((r) => !leader(r))];
    // "Thành viên" chỉ là tư cách chung — bỏ khi đã có chức vụ cụ thể
    const named = ordered.filter((r) => normalize(r.TenChucVu) !== 'thanh vien');
    result.push({
      key: 'ca-nhan',
      roleLabel: roles.length > 0 ? distinct((named.length ? named : ordered).map((r) => r.TenChucVu)).join(', ') : 'Người dùng',
      title: 'Trang cá nhân',
      scope: roles.length > 0 ? distinct(ordered.map((r) => r.TenDonVi)).join(', ') : 'Chưa thuộc đơn vị nào',
    });
  }
  return result;
}
