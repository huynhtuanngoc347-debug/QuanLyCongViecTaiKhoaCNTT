import type { TaskRights } from './task-access';

/** Trạng thái công việc (CongViec.TrangThai) và phân công (PhanCong.TrangThaiPhanCong). */
export const Draft = 0, NotStarted = 1, InProgress = 2, Review = 3, Done = 4, Paused = 5, Cancelled = 6;
export const AsWaiting = 0, AsAccepted = 1, AsWorking = 2, AsReview = 3, AsDone = 4, AsRejected = 5, AsCancelled = 6;
export const MAX_APPROVED_EXTENSIONS = 2;
export const DUE_SOON_DAYS = 3;
const DAY = 86400000;

// ----- Dòng đọc từ SQL -----
export interface TaskRow {
  MaCongViec: number; TieuDe: string; MoTa: string | null; TieuChiHoanThanh: string | null; NgayBatDau: Date | null; HanHoanThanh: Date | null;
  TrangThai: number; MucDoUuTien: number; PhanTramTienDo: number; NgayTao: Date; NgayHoanThanh: Date | null; MaNguoiTao: number; TenNguoiTao: string;
  MaDonViQuanLy: number; TenDonVi: string; MaTheLoai: number | null; TenTheLoai: string | null; MaCongViecCha: number | null; MaMauCongViec: number | null;
}
export interface AssignmentRow {
  MaPhanCong: number; MaCongViec: number; MaNguoiGiao: number; TenNguoiGiao: string; MaDonViGiao: number | null; MaNguoiNhan: number | null;
  TenNguoiNhan: string | null; MaDonViNhan: number | null; TenDonViNhan: string | null; NoiDungGiao: string | null; TrangThaiPhanCong: number;
  NgayGiao: Date; HanHoanThanh: Date; NgayTiepNhan: Date | null; NgayHoanThanh: Date | null; VaiTro: number | null; PhanTramBaoCao: number;
}
export interface ExtensionRow {
  MaYeuCau: number; MaPhanCong: number; MaNguoiYeuCau: number; TenNguoiYeuCau: string; HanCu: Date; HanDeXuat: Date; LyDo: string; TrangThai: number;
  MaNguoiDuyet: number | null; TenNguoiDuyet: string | null; HanDuocDuyet: Date | null; NhanXet: string | null; NgayTao: Date; NgayDuyet: Date | null;
}
export interface DeclineRow {
  MaYeuCau: number; MaPhanCong: number; MaNguoiYeuCau: number; TenNguoiYeuCau: string; LyDo: string; TrangThai: number;
  MaNguoiDuyet: number | null; TenNguoiDuyet: string | null; NhanXet: string | null; NgayTao: Date; NgayDuyet: Date | null;
}
/** Bảng xin từ chối (sql/04_XinTuChoi.sql); chưa chạy script thì tính năng tắt, các màn hình khác vẫn chạy. */
export const HAS_DECLINE_TABLE = "OBJECT_ID(N'dbo.YeuCauTuChoi', N'U') IS NOT NULL";
export interface FileRow {
  MaTep: number; MaCongViec: number | null; MaKetQua: number | null; MaBinhLuan: number | null; MaNguoiTaiLen: number; TenTep: string;
  DuongDan: string; LoaiTep: string | null; KichThuoc: number; NgayTaiLen: Date;
}

export const TASK_COLUMNS = `cv.MaCongViec, cv.TieuDe, cv.MoTa, cv.TieuChiHoanThanh, cv.NgayBatDau, cv.HanHoanThanh, cv.TrangThai,
  cv.MucDoUuTien, cv.PhanTramTienDo, cv.NgayTao, cv.NgayHoanThanh, cv.MaNguoiTao, nt.HoTen AS TenNguoiTao,
  cv.MaDonViQuanLy, dv.TenDonVi, cv.MaTheLoai, tl.TenTheLoai, cv.MaCongViecCha, cv.MaMauCongViec`;

export const TASK_FROM = `FROM dbo.CongViec AS cv
  JOIN dbo.NguoiDung AS nt ON nt.MaNguoiDung = cv.MaNguoiTao
  JOIN dbo.DonVi AS dv ON dv.MaDonVi = cv.MaDonViQuanLy
  LEFT JOIN dbo.TheLoaiCongViec AS tl ON tl.MaTheLoai = cv.MaTheLoai`;

export const ASSIGNMENT_COLUMNS = `p.MaPhanCong, p.MaCongViec, p.MaNguoiGiao, ng.HoTen AS TenNguoiGiao, p.MaDonViGiao, p.MaNguoiNhan,
  nn.HoTen AS TenNguoiNhan, p.MaDonViNhan, dn.TenDonVi AS TenDonViNhan, p.NoiDungGiao, p.TrangThaiPhanCong,
  p.NgayGiao, p.HanHoanThanh, p.NgayTiepNhan, p.NgayHoanThanh, p.VaiTro,
  CASE WHEN p.TrangThaiPhanCong = 4 THEN CONVERT(DECIMAL(5,2), 100)
       ELSE ISNULL(td.PhanTramTienDo, CONVERT(DECIMAL(5,2), 0)) END AS PhanTramBaoCao`;

export const assignmentFrom = (lock = false) => `FROM dbo.PhanCong AS p${lock ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
  JOIN dbo.NguoiDung AS ng ON ng.MaNguoiDung = p.MaNguoiGiao
  LEFT JOIN dbo.NguoiDung AS nn ON nn.MaNguoiDung = p.MaNguoiNhan
  LEFT JOIN dbo.DonVi AS dn ON dn.MaDonVi = p.MaDonViNhan
  OUTER APPLY (
      SELECT TOP (1) x.PhanTramTienDo
      FROM dbo.CapNhatTienDo AS x
      WHERE x.MaPhanCong = p.MaPhanCong
      ORDER BY x.NgayCapNhat DESC, x.MaTienDo DESC
  ) AS td`;

/**
 * Quy tắc quyền trên một công việc / phân công. Dùng chung cho bật/tắt nút (truy vấn) và kiểm tra trước mỗi thao tác ghi.
 */
export const isRunning = (t: TaskRow) => t.TrangThai === NotStarted || t.TrangThai === InProgress || t.TrangThai === Review;
/** Phân công còn hiệu lực (không từ chối/hủy). */
export const isActive = (a: AssignmentRow) => a.TrangThaiPhanCong !== AsRejected && a.TrangThaiPhanCong !== AsCancelled;
export const isOpenStatus = (s: number) => s === AsWaiting || s === AsAccepted || s === AsWorking;
export const isOpen = (a: AssignmentRow) => isOpenStatus(a.TrangThaiPhanCong);

/** Người tạo hoặc người có quyền giao việc ở đơn vị quản lý: sửa, giao, tạm dừng, hủy, đóng công việc. */
export const canManage = (r: TaskRights, t: TaskRow) => t.MaNguoiTao === r.userId || r.assignUnits.has(t.MaDonViQuanLy);
/** Trưởng/quản lý trực tiếp của đơn vị nhận (giữ chức vụ có quyền giao việc ngay tại đơn vị đó). */
export const isUnitManagerOf = (r: TaskRights, a: AssignmentRow) => a.MaDonViNhan != null && r.directAssignUnits.has(a.MaDonViNhan);
/** Người thực hiện: người nhận cá nhân, hoặc người quản lý đơn vị nhận. */
export const isAssignee = (r: TaskRights, a: AssignmentRow) => a.MaNguoiNhan === r.userId || isUnitManagerOf(r, a);
/** Người giao phân công đó, hoặc người có quyền duyệt/đánh giá ở đơn vị quản lý; không tự duyệt bài của mình. */
export const canEvaluate = (r: TaskRights, t: TaskRow, a: AssignmentRow) =>
  a.MaNguoiNhan !== r.userId && (a.MaNguoiGiao === r.userId || r.reviewUnits.has(t.MaDonViQuanLy));
export const canDecideExtension = (r: TaskRights, t: TaskRow, a: AssignmentRow, requesterId: number) =>
  requesterId !== r.userId && (a.MaNguoiGiao === r.userId || r.assignUnits.has(t.MaDonViQuanLy));
/** Duyệt xin từ chối: cùng người có quyền duyệt gia hạn. */
export const canDecideDecline = canDecideExtension;
export const related = (r: TaskRights, t: TaskRow, assignments: AssignmentRow[]) =>
  t.MaNguoiTao === r.userId || r.viewUnits.has(t.MaDonViQuanLy) || assignments.some((a) => a.MaNguoiGiao === r.userId || isAssignee(r, a));

export const isOverdue = (due: Date | null, status: number, now: Date) =>
  due != null && due < now && (status === NotStarted || status === InProgress);
export const isDueSoon = (due: Date | null, status: number, now: Date) =>
  due != null && due >= now && due.getTime() <= now.getTime() + DUE_SOON_DAYS * DAY && (status === NotStarted || status === InProgress);
export const assignmentOverdue = (a: AssignmentRow, now: Date) => isOpen(a) && a.HanHoanThanh < now;
export const assignmentDueSoon = (a: AssignmentRow, now: Date) =>
  isOpen(a) && a.HanHoanThanh >= now && a.HanHoanThanh.getTime() <= now.getTime() + DUE_SOON_DAYS * DAY;
