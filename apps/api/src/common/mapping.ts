import type { MembershipDto, PersonDto, RoleDto, UnitDto, PermissionKey } from '@khoa/shared';
import { collapseSpaces, initials, normalize } from './text';
import { formatDate } from './vn-time';

/** Ánh xạ giá trị SQL ↔ giá trị giao diện (Mapping.cs). */

/** LoaiDonVi (CK_DV_Loai) ↔ nhãn giao diện. */
export const UNIT_TYPE_LABELS: Record<string, string> = { Khoa: 'Khoa', BoMon: 'Bộ môn', Ban: 'Ban', Nhom: 'Nhóm', HoiDong: 'Hội đồng' };

/** Khóa quyền giao diện ↔ cột BIT trong dbo.ChucVu. */
export const PERMISSION_COLUMNS: [PermissionKey, string, string][] = [
  ['createTask', 'DuocTaoCongViec', 'Tạo công việc'],
  ['assignTask', 'DuocGiaoViec', 'Giao việc cho thành viên'],
  ['approveResult', 'DuocDuyetKetQua', 'Duyệt kết quả'],
  ['evaluateResult', 'DuocDanhGia', 'Đánh giá kết quả'],
  ['viewReport', 'DuocXemBaoCaoDonVi', 'Xem báo cáo của đơn vị'],
  ['manageMembers', 'DuocQuanLyThanhVien', 'Quản lý thành viên đơn vị'],
  ['includeChildren', 'ApDungChoDonViCon', 'Áp dụng quyền cho đơn vị con'],
];

/** Nhãn người dùng chọn/nhập → giá trị lưu ở LoaiDonVi; 5 loại có sẵn giữ mã cũ (BoMon, Nhom…). */
export function unitTypeToDb(label: string): string {
  const key = normalize(label).replace(/ /g, '');
  for (const [code, text] of Object.entries(UNIT_TYPE_LABELS)) {
    if (normalize(code) === key || normalize(text).replace(/ /g, '') === key) return code;
  }
  return collapseSpaces(label);
}

export const unitTypeLabel = (dbValue: string): string => UNIT_TYPE_LABELS[dbValue] ?? dbValue;

/** Schema chưa có cột mã nhân sự: hiển thị mã dẫn xuất từ khóa chính. */
export const employeeCode = (id: number): string => `ND${String(id).padStart(3, '0')}`;

// ----- Dòng đọc từ SQL -----
export interface UnitRow { MaDonVi: number; TenDonVi: string; LoaiDonVi: string; MoTa: string | null; TrangThai: boolean; MaDonViCha: number | null; }
export interface PersonRow {
  MaNguoiDung: number; HoTen: string; HocHam: string | null; HocVi: string | null; TinhTrangDaoTao: string | null;
  Email: string; SoDienThoai: string | null; LaQuanTriHeThong: boolean; TrangThaiTaiKhoan: boolean;
}
export interface RoleRow {
  MaChucVu: number; TenChucVu: string; MoTa: string | null; DuocTaoCongViec: boolean; DuocGiaoViec: boolean; DuocDuyetKetQua: boolean;
  DuocDanhGia: boolean; DuocXemBaoCaoDonVi: boolean; DuocQuanLyThanhVien: boolean; ApDungChoDonViCon: boolean; TrangThai: boolean;
}
export interface MembershipRow { MaNguoiDung: number; MaDonVi: number; MaChucVu: number; LaDonViChinh: boolean; NgayThamGia: Date; NgayKetThuc: Date | null; TrangThai: boolean; }

export const UNIT_COLUMNS = 'MaDonVi, TenDonVi, LoaiDonVi, MoTa, TrangThai, MaDonViCha';
export const PERSON_COLUMNS = 'MaNguoiDung, HoTen, HocHam, HocVi, TinhTrangDaoTao, Email, SoDienThoai, LaQuanTriHeThong, TrangThaiTaiKhoan';
export const ROLE_COLUMNS =
  'MaChucVu, TenChucVu, MoTa, DuocTaoCongViec, DuocGiaoViec, DuocDuyetKetQua, DuocDanhGia, DuocXemBaoCaoDonVi, DuocQuanLyThanhVien, ApDungChoDonViCon, TrangThai';
export const MEMBERSHIP_COLUMNS = 'MaNguoiDung, MaDonVi, MaChucVu, LaDonViChinh, NgayThamGia, NgayKetThuc, TrangThai';

export const unitDto = (r: UnitRow): UnitDto => ({
  id: r.MaDonVi, code: String(r.MaDonVi), name: r.TenDonVi, type: unitTypeLabel(r.LoaiDonVi),
  parentId: r.MaDonViCha ?? null, active: !!r.TrangThai, description: r.MoTa ?? '',
});

export const personDto = (r: PersonRow): PersonDto => ({
  id: r.MaNguoiDung, employeeCode: employeeCode(r.MaNguoiDung), name: r.HoTen, initials: initials(r.HoTen), email: r.Email,
  degree: r.HocVi ?? '', academicTitle: r.HocHam ?? '', training: r.TinhTrangDaoTao ?? '', phone: r.SoDienThoai ?? '',
  active: !!r.TrangThaiTaiKhoan, isSystemAdmin: !!r.LaQuanTriHeThong,
});

export const roleDto = (r: RoleRow): RoleDto => ({
  id: r.MaChucVu, name: r.TenChucVu, description: r.MoTa ?? '', active: !!r.TrangThai,
  permissions: {
    createTask: !!r.DuocTaoCongViec, assignTask: !!r.DuocGiaoViec, approveResult: !!r.DuocDuyetKetQua,
    evaluateResult: !!r.DuocDanhGia, viewReport: !!r.DuocXemBaoCaoDonVi, manageMembers: !!r.DuocQuanLyThanhVien,
    includeChildren: !!r.ApDungChoDonViCon,
  },
});

export const membershipDto = (r: MembershipRow): MembershipDto => ({
  personId: r.MaNguoiDung, unitId: r.MaDonVi, roleId: r.MaChucVu, primary: !!r.LaDonViChinh,
  start: formatDate(r.NgayThamGia), end: r.NgayKetThuc ? formatDate(r.NgayKetThuc) : '',
});
