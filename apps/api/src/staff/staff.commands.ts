import { Injectable } from '@nestjs/common';
import type { CreatedPersonDto, PasswordResetDto, PersonDto } from '@khoa/shared';
import { DbService, SqlRunner, sqlErrorNumber } from '../db/db.service';
import { Result, fail, invalid, ok } from '../common/result';
import { writeAudit } from '../common/audit-log';
import { MEMBERSHIP_COLUMNS, PERSON_COLUMNS, membershipDto, personDto, type MembershipRow, type PersonRow } from '../common/mapping';
import { collapseSpaces, nullIfEmpty, toBool } from '../common/text';
import { loadActiveUser } from '../auth/access.service';
import { generateTemporaryPassword, hashPassword } from '../auth/password-hasher';

const UNIQUE_INDEX = 2601, UNIQUE_CONSTRAINT = 2627, FOREIGN_KEY = 547;
const PHONE = /^[0-9+().\s-]{6,20}$/;

interface CleanPerson { name: string; email: string; academicTitle: string | null; degree: string | null; training: string | null; phone: string | null; isSystemAdmin: boolean; }

function isValidEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254 || email.includes(' ')) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && !/[\s<>(),;:"[\]\\]/.test(email);
}

function validate(input: Record<string, unknown>): { value: CleanPerson; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = collapseSpaces(input.name);
  const email = String(input.email ?? '').trim();
  const academicTitle = nullIfEmpty(input.academicTitle), degree = nullIfEmpty(input.degree), training = nullIfEmpty(input.training), phone = nullIfEmpty(input.phone);
  const isAdmin = toBool(input.isSystemAdmin);
  if (name.length < 2 || name.length > 150) errors.name = 'Họ và tên cần có từ 2 đến 150 ký tự.';
  if (!isValidEmail(email)) errors.email = 'Nhập email hợp lệ, ví dụ tennv@huit.edu.vn.';
  if (academicTitle && academicTitle.length > 50) errors.academicTitle = 'Học hàm tối đa 50 ký tự.';
  if (degree && degree.length > 50) errors.degree = 'Học vị tối đa 50 ký tự.';
  if (training && training.length > 100) errors.training = 'Tình trạng đào tạo tối đa 100 ký tự.';
  if (phone && !PHONE.test(phone)) errors.phone = 'Số điện thoại gồm 6–20 ký tự: chữ số, khoảng trắng, +, -, (, ), dấu chấm.';
  if (isAdmin === null) errors.isSystemAdmin = 'Chọn có hoặc không.';
  return { value: { name, email, academicTitle, degree, training, phone, isSystemAdmin: isAdmin === true }, errors };
}

/** Dữ liệu ghi nhật ký (không có mật khẩu). */
const auditView = (p: PersonRow) => ({
  hoTen: p.HoTen, email: p.Email, hocHam: p.HocHam, hocVi: p.HocVi, tinhTrangDaoTao: p.TinhTrangDaoTao,
  soDienThoai: p.SoDienThoai, laQuanTriHeThong: !!p.LaQuanTriHeThong, trangThaiTaiKhoan: !!p.TrangThaiTaiKhoan,
});

async function requireAdmin(db: SqlRunner, actorId: number): Promise<Result<PersonRow>> {
  const actor = await loadActiveUser(db, actorId);
  if (!actor) return fail(401, 'Phiên đăng nhập không còn hiệu lực.');
  if (!actor.LaQuanTriHeThong) return fail(403, 'Chỉ quản trị hệ thống được quản lý tài khoản nhân sự.');
  return ok(actor);
}

const lockPerson = (db: SqlRunner, id: number) =>
  db.one<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM dbo.NguoiDung WITH (UPDLOCK, HOLDLOCK) WHERE MaNguoiDung = @id;`, { id });

/** Luôn giữ ít nhất một quản trị hệ thống đang hoạt động (không kể người đang bị thay đổi). */
async function hasOtherActiveAdmin(db: SqlRunner, exceptId: number): Promise<boolean> {
  const n = await db.scalar<number>(
    'SELECT COUNT(*) FROM dbo.NguoiDung WITH (UPDLOCK, HOLDLOCK) WHERE LaQuanTriHeThong = 1 AND TrangThaiTaiKhoan = 1 AND MaNguoiDung <> @exceptId;',
    { exceptId },
  );
  return (n ?? 0) > 0;
}

async function emailTaken(db: SqlRunner, email: string, exceptId: number | null): Promise<boolean> {
  const n = await db.scalar<number>(
    'SELECT COUNT(*) FROM dbo.NguoiDung WITH (UPDLOCK, HOLDLOCK) WHERE Email = @email AND (@exceptId IS NULL OR MaNguoiDung <> @exceptId);',
    { email, exceptId },
  );
  return (n ?? 0) > 0;
}

/**
 * Quản lý tài khoản nhân sự (chỉ quản trị hệ thống): thêm, sửa hồ sơ, cấp lại mật khẩu, khóa/mở khóa, xóa.
 * Mọi thao tác ghi NhatKyHeThong trong cùng giao dịch, không ghi mật khẩu hay MatKhauBam.
 */
@Injectable()
export class StaffCommands {
  constructor(private readonly db: DbService) {}

  async create(actorId: number, input: Record<string, unknown>, ip: string | null): Promise<Result<CreatedPersonDto>> {
    const { value: person, errors: inputErrors } = validate(input);
    const active = toBool(input.active);
    if (active === null) inputErrors.active = 'Chọn trạng thái tài khoản.';
    const temporaryPassword = generateTemporaryPassword();
    const hash = await hashPassword(temporaryPassword);
    try {
      return await this.db.tx(actorId, async (db) => {
        const errors = { ...inputErrors };
        const admin = await requireAdmin(db, actorId);
        if (admin.kind !== 'ok') return admin as Result<never>;
        if (!errors.email && (await emailTaken(db, person.email, null))) errors.email = 'Email đã được dùng cho tài khoản khác.';
        if (Object.keys(errors).length) return invalid(errors);
        const row: PersonRow = {
          MaNguoiDung: 0, HoTen: person.name, Email: person.email, HocHam: person.academicTitle, HocVi: person.degree,
          TinhTrangDaoTao: person.training, SoDienThoai: person.phone, LaQuanTriHeThong: person.isSystemAdmin, TrangThaiTaiKhoan: active === true,
        };
        row.MaNguoiDung = (await db.scalar<number>(
          `INSERT dbo.NguoiDung (HoTen, HocHam, HocVi, TinhTrangDaoTao, Email, SoDienThoai, MatKhauBam, LaQuanTriHeThong, TrangThaiTaiKhoan)
           VALUES (@HoTen, @HocHam, @HocVi, @TinhTrangDaoTao, @Email, @SoDienThoai, @Hash, @LaQuanTriHeThong, @TrangThaiTaiKhoan);
           SELECT CONVERT(INT, SCOPE_IDENTITY());`,
          { HoTen: row.HoTen, HocHam: row.HocHam, HocVi: row.HocVi, TinhTrangDaoTao: row.TinhTrangDaoTao, Email: row.Email, SoDienThoai: row.SoDienThoai, Hash: hash, LaQuanTriHeThong: row.LaQuanTriHeThong, TrangThaiTaiKhoan: row.TrangThaiTaiKhoan },
        ))!;
        await writeAudit(db, actorId, 'TaoNguoiDung', 'NguoiDung', String(row.MaNguoiDung), null, auditView(row), ip);
        return ok({ person: personDto(row), temporaryPassword });
      });
    } catch (e) {
      const n = sqlErrorNumber(e);
      if (n === UNIQUE_INDEX || n === UNIQUE_CONSTRAINT) return invalid({ email: 'Email đã được dùng cho tài khoản khác.' });
      throw e;
    }
  }

  async update(actorId: number, id: number, input: Record<string, unknown>, ip: string | null): Promise<Result<PersonDto>> {
    const { value: person, errors: inputErrors } = validate(input);
    try {
      return await this.db.tx(actorId, async (db) => {
        const errors = { ...inputErrors };
        const admin = await requireAdmin(db, actorId);
        if (admin.kind !== 'ok') return admin as Result<never>;
        const before = await lockPerson(db, id);
        if (!before) return fail(404, 'Không tìm thấy nhân sự.');
        if (!errors.email && (await emailTaken(db, person.email, id))) errors.email = 'Email đã được dùng cho tài khoản khác.';
        if (before.LaQuanTriHeThong && !person.isSystemAdmin && !errors.isSystemAdmin) {
          if (id === actorId) errors.isSystemAdmin = 'Không thể tự bỏ quyền quản trị của chính mình.';
          else if (before.TrangThaiTaiKhoan && !(await hasOtherActiveAdmin(db, id))) errors.isSystemAdmin = 'Hệ thống cần ít nhất một quản trị viên đang hoạt động.';
        }
        if (Object.keys(errors).length) return invalid(errors);
        const after: PersonRow = {
          MaNguoiDung: id, HoTen: person.name, Email: person.email, HocHam: person.academicTitle, HocVi: person.degree,
          TinhTrangDaoTao: person.training, SoDienThoai: person.phone, LaQuanTriHeThong: person.isSystemAdmin, TrangThaiTaiKhoan: before.TrangThaiTaiKhoan,
        };
        await db.exec(
          `UPDATE dbo.NguoiDung
           SET HoTen = @HoTen, Email = @Email, HocHam = @HocHam, HocVi = @HocVi, TinhTrangDaoTao = @TinhTrangDaoTao,
               SoDienThoai = @SoDienThoai, LaQuanTriHeThong = @LaQuanTriHeThong
           WHERE MaNguoiDung = @MaNguoiDung;`,
          { HoTen: after.HoTen, Email: after.Email, HocHam: after.HocHam, HocVi: after.HocVi, TinhTrangDaoTao: after.TinhTrangDaoTao, SoDienThoai: after.SoDienThoai, LaQuanTriHeThong: after.LaQuanTriHeThong, MaNguoiDung: id },
        );
        await writeAudit(db, actorId, 'CapNhatNguoiDung', 'NguoiDung', String(id), auditView(before), auditView(after), ip);
        return ok(personDto(after));
      });
    } catch (e) {
      const n = sqlErrorNumber(e);
      if (n === UNIQUE_INDEX || n === UNIQUE_CONSTRAINT) return invalid({ email: 'Email đã được dùng cho tài khoản khác.' });
      throw e;
    }
  }

  async resetPassword(actorId: number, id: number, ip: string | null): Promise<Result<PasswordResetDto>> {
    const temporaryPassword = generateTemporaryPassword();
    const hash = await hashPassword(temporaryPassword);
    return this.db.tx(actorId, async (db) => {
      const admin = await requireAdmin(db, actorId);
      if (admin.kind !== 'ok') return admin as Result<never>;
      if (id === actorId) return fail(400, 'Hãy dùng chức năng Đổi mật khẩu cho tài khoản của chính bạn.');
      const target = await lockPerson(db, id);
      if (!target) return fail(404, 'Không tìm thấy nhân sự.');
      // Đổi hash làm dấu vân tay trong token cũ không còn khớp → mọi phiên của người này bị đăng xuất.
      await db.exec('UPDATE dbo.NguoiDung SET MatKhauBam = @hash WHERE MaNguoiDung = @id;', { hash, id });
      await writeAudit(db, actorId, 'CapLaiMatKhau', 'NguoiDung', String(id), null, { hoTen: target.HoTen, email: target.Email }, ip);
      return ok({ personId: id, temporaryPassword });
    });
  }

  async setStatus(actorId: number, id: number, input: Record<string, unknown>, ip: string | null): Promise<Result<PersonDto>> {
    const active = toBool(input.active);
    if (active === null) return invalid({ active: 'Chọn khóa hoặc mở khóa.' });
    return this.db.tx(actorId, async (db) => {
      const admin = await requireAdmin(db, actorId);
      if (admin.kind !== 'ok') return admin as Result<never>;
      if (id === actorId && !active) return fail(400, 'Không thể tự khóa tài khoản đang đăng nhập.');
      const before = await lockPerson(db, id);
      if (!before) return fail(404, 'Không tìm thấy nhân sự.');
      if (!!before.TrangThaiTaiKhoan === active) return ok(personDto(before));
      if (!active && before.LaQuanTriHeThong && !(await hasOtherActiveAdmin(db, id))) return fail(409, 'Hệ thống cần ít nhất một quản trị viên đang hoạt động.');
      await db.exec('UPDATE dbo.NguoiDung SET TrangThaiTaiKhoan = @active WHERE MaNguoiDung = @id;', { active, id });
      await writeAudit(db, actorId, active ? 'MoKhoaTaiKhoan' : 'KhoaTaiKhoan', 'NguoiDung', String(id), { trangThaiTaiKhoan: !!before.TrangThaiTaiKhoan }, { trangThaiTaiKhoan: active }, ip);
      return ok(personDto({ ...before, TrangThaiTaiKhoan: active }));
    });
  }

  /**
   * Chỉ xóa hẳn tài khoản chưa phát sinh lịch sử (theo quy tắc "không xóa dây chuyền, giữ lịch sử").
   * Tài khoản đã có lịch sử phải dùng Khóa tài khoản. Dòng ThanhVienDonVi được xóa kèm và lưu trong nhật ký.
   */
  async remove(actorId: number, id: number, ip: string | null): Promise<Result<true>> {
    try {
      return await this.db.tx(actorId, async (db) => {
        const admin = await requireAdmin(db, actorId);
        if (admin.kind !== 'ok') return admin as Result<never>;
        if (id === actorId) return fail(400, 'Không thể xóa tài khoản đang đăng nhập.');
        const target = await lockPerson(db, id);
        if (!target) return fail(404, 'Không tìm thấy nhân sự.');
        if (target.LaQuanTriHeThong && target.TrangThaiTaiKhoan && !(await hasOtherActiveAdmin(db, id))) return fail(409, 'Hệ thống cần ít nhất một quản trị viên đang hoạt động.');
        const usage = (await db.one<Record<string, number>>(
          `SELECT
              (SELECT COUNT(*) FROM dbo.CongViec WHERE MaNguoiTao = @id) AS CongViec,
              (SELECT COUNT(*) FROM dbo.PhanCong WHERE MaNguoiGiao = @id OR MaNguoiNhan = @id) AS PhanCong,
              (SELECT COUNT(*) FROM dbo.CapNhatTienDo WHERE MaNguoiCapNhat = @id) AS TienDo,
              (SELECT COUNT(*) FROM dbo.KetQuaCongViec WHERE MaNguoiNop = @id) AS KetQua,
              (SELECT COUNT(*) FROM dbo.DanhGia WHERE MaNguoiDanhGia = @id) AS DanhGia,
              (SELECT COUNT(*) FROM dbo.BinhLuan WHERE MaNguoiViet = @id) AS BinhLuan,
              (SELECT COUNT(*) FROM dbo.TepDinhKem WHERE MaNguoiTaiLen = @id) AS TepDinhKem,
              (SELECT COUNT(*) FROM dbo.LichSuCongViec WHERE MaNguoiThucHien = @id) AS LichSu,
              (SELECT COUNT(*) FROM dbo.ThongBao WHERE MaNguoiNhan = @id) AS ThongBao,
              (SELECT COUNT(*) FROM dbo.NhatKyHeThong WHERE MaNguoiThaoTac = @id) AS NhatKy;`,
          { id },
        ))!;
        const labels: [string, string][] = [
          ['CongViec', 'công việc đã tạo'], ['PhanCong', 'phân công'], ['TienDo', 'cập nhật tiến độ'], ['KetQua', 'kết quả đã nộp'],
          ['DanhGia', 'đánh giá'], ['BinhLuan', 'bình luận'], ['TepDinhKem', 'tệp đính kèm'], ['LichSu', 'lịch sử công việc'],
          ['ThongBao', 'thông báo'], ['NhatKy', 'nhật ký đăng nhập/thao tác'],
        ];
        const reasons = labels.filter(([k]) => usage[k] > 0).map(([k, l]) => `${l} (${usage[k]})`);
        if (reasons.length) return fail(409, `Tài khoản đã có lịch sử: ${reasons.join(', ')}. Để giữ lịch sử, hệ thống không xóa tài khoản này. Hãy dùng Khóa tài khoản.`);
        const memberships = (await db.query<MembershipRow>(`SELECT ${MEMBERSHIP_COLUMNS} FROM dbo.ThanhVienDonVi WITH (UPDLOCK, HOLDLOCK) WHERE MaNguoiDung = @id;`, { id })).map(membershipDto);
        await db.exec('DELETE FROM dbo.ThanhVienDonVi WHERE MaNguoiDung = @id;', { id });
        await db.exec('DELETE FROM dbo.NguoiDung WHERE MaNguoiDung = @id;', { id });
        await writeAudit(db, actorId, 'XoaNguoiDung', 'NguoiDung', String(id), { nguoiDung: auditView(target), thanhVienDonVi: memberships }, null, ip);
        return ok(true as const);
      });
    } catch (e) {
      if (sqlErrorNumber(e) === FOREIGN_KEY) return fail(409, 'Tài khoản đã có dữ liệu liên quan nên không thể xóa. Hãy dùng Khóa tài khoản.');
      throw e;
    }
  }
}
