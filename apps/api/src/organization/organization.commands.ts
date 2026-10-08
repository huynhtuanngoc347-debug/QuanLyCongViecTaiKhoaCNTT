import { Injectable } from '@nestjs/common';
import type { CreatedUnitDto, MembershipDto, RoleDto, UnitDto } from '@khoa/shared';
import { DbService, SqlRunner, sqlErrorMessage, sqlErrorNumber } from '../db/db.service';
import { Result, fail, invalid, ok } from '../common/result';
import { writeAudit } from '../common/audit-log';
import {
  MEMBERSHIP_COLUMNS, ROLE_COLUMNS, membershipDto, roleDto, unitDto, unitTypeLabel, unitTypeToDb,
  type MembershipRow, type RoleRow, type UnitRow,
} from '../common/mapping';
import { clean, collapseSpaces, toBool, toInt, toStr } from '../common/text';
import { formatDate, parseYmd } from '../common/vn-time';
import { loadActiveUser, manageableUnitIds } from '../auth/access.service';

const UNIQUE_INDEX = 2601, UNIQUE_CONSTRAINT = 2627, PRIMARY_UNIT_TRIGGER = 51005, UNIT_CYCLE_TRIGGER = 51001, CHECK_CONSTRAINT = 547;

interface UnitDraft { name: string; typeDb: string; typeLabel: string; }

/** Kiểm tra tên + loại; khóa lỗi có tiền tố (ví dụ "newParent") để chỉ đúng ô nhập. */
function checkUnitFields(rawName: unknown, rawType: unknown, prefix: string, errors: Record<string, string>, subject: string): UnitDraft {
  const name = collapseSpaces(rawName), type = collapseSpaces(rawType);
  const nameKey = prefix ? prefix + 'Name' : 'name', typeKey = prefix ? prefix + 'Type' : 'type';
  if (name.length === 0) errors[nameKey] = `Chưa nhập tên ${subject}.`;
  else if (name.length < 2) errors[nameKey] = `Tên ${subject} quá ngắn: cần ít nhất 2 ký tự.`;
  else if (name.length > 150) errors[nameKey] = `Tên ${subject} dài ${name.length} ký tự; tối đa 150 ký tự.`;
  if (type.length === 0) errors[typeKey] = `Chưa chọn hoặc nhập loại ${subject} (ví dụ Bộ môn, Nhóm, Trung tâm).`;
  else if (type.length > 30) errors[typeKey] = `Loại ${subject} dài ${type.length} ký tự; tối đa 30 ký tự.`;
  else if (!/\p{L}/u.test(type)) errors[typeKey] = `Loại ${subject} phải có chữ, ví dụ “Trung tâm”.`;
  const typeDb = unitTypeToDb(type);
  return { name, typeDb, typeLabel: unitTypeLabel(typeDb) };
}

interface ParentRow { MaDonVi: number; TenDonVi: string; TrangThai: boolean; }

async function checkExistingParent(db: SqlRunner, parentId: number | null, key: string, errors: Record<string, string>, whose: string): Promise<ParentRow | null> {
  if (parentId == null) {
    errors[key] = `Chưa chọn đơn vị cha cho ${whose}. Chọn một đơn vị, “Không có đơn vị cha” hoặc “Tạo đơn vị cha mới”.`;
    return null;
  }
  const parent = await db.one<ParentRow>('SELECT MaDonVi, TenDonVi, TrangThai FROM dbo.DonVi WITH (UPDLOCK, HOLDLOCK) WHERE MaDonVi = @parentId;', { parentId });
  if (!parent) errors[key] = `Đơn vị cha mã ${parentId} không còn tồn tại. Tải lại trang rồi chọn lại.`;
  else if (!parent.TrangThai) errors[key] = `Đơn vị cha “${parent.TenDonVi}” đang ngừng hoạt động. Chọn đơn vị khác hoặc kích hoạt lại “${parent.TenDonVi}” trước.`;
  return parent;
}

/** Không trùng tên (không phân biệt hoa/thường) trong cùng một đơn vị cha, kể cả nhóm đơn vị gốc. */
async function checkSiblingName(db: SqlRunner, parentId: number | null, parentName: string | null, name: string, key: string, errors: Record<string, string>): Promise<void> {
  const existing = await db.scalar<number>(
    `SELECT TOP (1) MaDonVi FROM dbo.DonVi WITH (UPDLOCK, HOLDLOCK)
     WHERE ((@parentId IS NULL AND MaDonViCha IS NULL) OR MaDonViCha = @parentId)
       AND LOWER(LTRIM(RTRIM(TenDonVi))) = LOWER(@name);`,
    { parentId, name },
  );
  if (existing != null) {
    errors[key] = parentId == null
      ? `Đã có đơn vị gốc tên “${name}” (mã ${existing}). Đặt tên khác hoặc chọn đơn vị cha.`
      : `“${parentName}” đã có đơn vị con tên “${name}” (mã ${existing}). Đặt tên khác.`;
  }
}

async function insertUnit(db: SqlRunner, row: Omit<UnitRow, 'MaDonVi'>): Promise<UnitRow> {
  const id = await db.scalar<number>(
    `INSERT dbo.DonVi (TenDonVi, LoaiDonVi, MoTa, TrangThai, MaDonViCha)
     VALUES (@TenDonVi, @LoaiDonVi, @MoTa, @TrangThai, @MaDonViCha);
     SELECT CONVERT(INT, SCOPE_IDENTITY());`,
    { ...row },
  );
  return { ...row, MaDonVi: id! };
}

/** Hai khoảng ngày giao nhau (null = vô hạn), tính cả ngày cuối. So sánh chuỗi yyyy-MM-dd. */
function overlaps(m: MembershipRow, start: string, end: string | null): boolean {
  const mStart = formatDate(m.NgayThamGia), mEnd = m.NgayKetThuc ? formatDate(m.NgayKetThuc) : '9999-12-31';
  return start <= mEnd && mStart <= (end ?? '9999-12-31');
}

/**
 * Thao tác ghi của phân hệ tổ chức. Mỗi thao tác: đọc lại người thao tác + quyền trong CSDL, kiểm tra dữ liệu theo từng trường,
 * khóa bản ghi liên quan (UPDLOCK, HOLDLOCK), ghi dữ liệu + NhatKyHeThong trong cùng giao dịch.
 */
@Injectable()
export class OrganizationCommands {
  constructor(private readonly db: DbService) {}

  async createUnit(userId: number, input: Record<string, unknown>, ip: string | null): Promise<Result<CreatedUnitDto>> {
    const mode = (toStr(input.parentMode) ?? 'existing').trim().toLowerCase();
    const description = clean(input.description);
    const activeInput = toBool(input.active);
    try {
      return await this.db.tx(userId, async (db) => {
        const errors: Record<string, string> = {};
        const actor = await loadActiveUser(db, userId);
        if (!actor) return fail(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');
        if (!actor.LaQuanTriHeThong) return fail(403, 'Chỉ quản trị hệ thống được thêm đơn vị vào cơ cấu tổ chức.');

        const unit = checkUnitFields(input.name, input.type, '', errors, 'đơn vị');
        if (description.length > 1000) errors.description = `Mô tả dài ${description.length} ký tự; tối đa 1.000 ký tự.`;
        if (activeInput === null) errors.active = 'Chọn trạng thái: Đang hoạt động hoặc Ngừng hoạt động.';

        let parentId: number | null = null, parentName: string | null = null;
        let newParent: UnitDraft | null = null, newParentParentId: number | null = null, newParentParentName: string | null = null;

        switch (mode) {
          case 'existing': {
            const parent = await checkExistingParent(db, toInt(input.parentId), 'parentId', errors, 'đơn vị mới');
            parentId = parent?.MaDonVi ?? null;
            parentName = parent?.TenDonVi ?? null;
            break;
          }
          case 'none':
            break;
          case 'new': {
            const np = input.newParent as Record<string, unknown> | null | undefined;
            if (!np || typeof np !== 'object') { errors.newParentName = 'Chưa nhập thông tin đơn vị cha mới.'; break; }
            newParent = checkUnitFields(np.name, np.type, 'newParent', errors, 'đơn vị cha mới');
            if ((toStr(np.parentMode) ?? 'none').toLowerCase() !== 'none') {
              const grand = await checkExistingParent(db, toInt(np.parentId), 'newParentParentId', errors, 'đơn vị cha mới');
              newParentParentId = grand?.MaDonVi ?? null;
              newParentParentName = grand?.TenDonVi ?? null;
            }
            if (!errors.newParentName) await checkSiblingName(db, newParentParentId, newParentParentName, newParent.name, 'newParentName', errors);
            if (!errors.name && !errors.newParentName && unit.name.toLocaleLowerCase('vi') === newParent.name.toLocaleLowerCase('vi'))
              errors.name = 'Tên đơn vị trùng tên đơn vị cha mới. Đặt tên khác để dễ phân biệt.';
            break;
          }
          default:
            errors.parentId = 'Cách chọn đơn vị cha không hợp lệ. Tải lại trang rồi thử lại.';
        }
        if (mode !== 'new' && !errors.name && !errors.parentId) await checkSiblingName(db, parentId, parentName, unit.name, 'name', errors);
        if (Object.keys(errors).length) return invalid(errors);

        let createdParent: UnitDto | null = null;
        if (newParent) {
          // Tạo cha trước để có MaDonVi làm MaDonViCha cho đơn vị con.
          const parentRow = await insertUnit(db, { TenDonVi: newParent.name, LoaiDonVi: newParent.typeDb, MoTa: null, TrangThai: true, MaDonViCha: newParentParentId });
          createdParent = unitDto(parentRow);
          await writeAudit(db, userId, 'TaoDonVi', 'DonVi', String(parentRow.MaDonVi), null, createdParent, ip);
          parentId = parentRow.MaDonVi;
        }
        const row = await insertUnit(db, {
          TenDonVi: unit.name, LoaiDonVi: unit.typeDb, MoTa: description.length === 0 ? null : description,
          TrangThai: activeInput === true, MaDonViCha: parentId,
        });
        const dto = unitDto(row);
        await writeAudit(db, userId, 'TaoDonVi', 'DonVi', String(row.MaDonVi), null, dto, ip);
        return ok({ unit: dto, createdParent });
      });
    } catch (e) {
      const n = sqlErrorNumber(e);
      if (n === CHECK_CONSTRAINT && sqlErrorMessage(e).includes('CK_DV_Loai'))
        return invalid({ type: 'CSDL chưa cho phép loại đơn vị mới. Quản trị cần chạy sql/02_MoRong_LoaiDonVi.sql, hoặc chọn một loại có sẵn: Khoa, Bộ môn, Ban, Nhóm, Hội đồng.' });
      if (n === UNIT_CYCLE_TRIGGER) return invalid({ parentId: 'Đơn vị cha đã chọn tạo vòng lặp trong cơ cấu. Chọn đơn vị cha khác.' });
      throw e;
    }
  }

  async createMembership(userId: number, input: Record<string, unknown>, ip: string | null): Promise<Result<MembershipDto>> {
    const inputErrors: Record<string, string> = {};
    const personIdIn = toInt(input.personId), unitIdIn = toInt(input.unitId), roleIdIn = toInt(input.roleId);
    const startText = clean(input.start), endText = clean(input.end);
    const start = parseYmd(startText) ? startText : null;
    const end = endText.length === 0 ? null : parseYmd(endText) ? endText : null;
    const primaryIn = toBool(input.primary);
    if (personIdIn == null) inputErrors.personId = 'Chọn người dùng đang hoạt động.';
    if (unitIdIn == null) inputErrors.unitId = 'Chọn đơn vị đang hoạt động.';
    if (roleIdIn == null) inputErrors.roleId = 'Chọn chức vụ hợp lệ.';
    if (!start) inputErrors.start = 'Nhập ngày tham gia hợp lệ.';
    if (endText.length > 0 && !end) inputErrors.end = 'Nhập ngày kết thúc hợp lệ.';
    else if (start && end && end < start) inputErrors.end = 'Ngày kết thúc phải từ ngày tham gia trở đi.';
    if (primaryIn === null) inputErrors.primary = 'Chọn đơn vị chính hoặc kiêm nhiệm.';

    try {
      return await this.db.tx(userId, async (db) => {
        const errors: Record<string, string> = { ...inputErrors };
        const actor = await loadActiveUser(db, userId);
        if (!actor) return fail(401, 'Phiên đăng nhập không còn hiệu lực.');
        // Quyền: quản trị hệ thống, hoặc chức vụ DuocQuanLyThanhVien có phạm vi chứa đơn vị này.
        if (unitIdIn != null) {
          const manageable = await manageableUnitIds(db, actor);
          if (!manageable.includes(unitIdIn)) return fail(403, 'Bạn không có quyền quản lý thành viên của đơn vị này.');
        }
        if (personIdIn != null && (await db.scalar<boolean>('SELECT TrangThaiTaiKhoan FROM dbo.NguoiDung WITH (UPDLOCK, HOLDLOCK) WHERE MaNguoiDung = @pid;', { pid: personIdIn })) !== true)
          errors.personId = 'Chọn người dùng đang hoạt động.';
        if (unitIdIn != null && (await db.scalar<boolean>('SELECT TrangThai FROM dbo.DonVi WHERE MaDonVi = @uid;', { uid: unitIdIn })) !== true)
          errors.unitId = 'Chọn đơn vị đang hoạt động.';
        if (roleIdIn != null) {
          const role = await db.one<RoleRow>(`SELECT ${ROLE_COLUMNS} FROM dbo.ChucVu WHERE MaChucVu = @rid;`, { rid: roleIdIn });
          if (!role || !role.TrangThai) errors.roleId = 'Chọn chức vụ hợp lệ.';
          // Chống tự nâng quyền: chỉ quản trị hệ thống được gán chức vụ có quyền quản lý thành viên.
          else if (!actor.LaQuanTriHeThong && role.DuocQuanLyThanhVien) errors.roleId = 'Chỉ quản trị hệ thống được gán chức vụ có quyền quản lý thành viên.';
        }
        if (Object.keys(errors).length) return invalid(errors);

        const personId = personIdIn!, unitId = unitIdIn!, roleId = roleIdIn!, primary = primaryIn!, newStart = start!, newEnd = end;
        // Khóa mọi dòng thành viên của người này (tránh hai đơn vị chính khi ghi đồng thời).
        const existing = await db.query<MembershipRow>(`SELECT ${MEMBERSHIP_COLUMNS} FROM dbo.ThanhVienDonVi WITH (UPDLOCK, HOLDLOCK) WHERE MaNguoiDung = @personId;`, { personId });
        const sameTriple = existing.find((m) => m.MaDonVi === unitId && m.MaChucVu === roleId);
        let reappoint = false;
        if (sameTriple) {
          // Bộ ba chỉ lưu một dòng. Tái bổ nhiệm được khi dòng cũ đã ngừng hoặc đã kết thúc trước ngày mới.
          const oldEnded = sameTriple.NgayKetThuc != null && formatDate(sameTriple.NgayKetThuc) < newStart;
          if (sameTriple.TrangThai && !oldEnded) return invalid({ roleId: 'Người dùng đã có chức vụ này tại đơn vị trong thời gian này. Không thể tạo trùng bộ ba.' });
          reappoint = true;
        }
        // Đơn vị chính (cùng quy tắc với trigger TR_ThanhVien_DonViChinh).
        const others = existing.filter((m) => m.TrangThai && !(m.MaDonVi === unitId && m.MaChucVu === roleId) && overlaps(m, newStart, newEnd));
        const otherPrimary = others.find((m) => primary && m.LaDonViChinh && m.MaDonVi !== unitId);
        if (otherPrimary) {
          const unitName = await db.scalar<string>('SELECT TenDonVi FROM dbo.DonVi WHERE MaDonVi = @id;', { id: otherPrimary.MaDonVi });
          return invalid({ primary: `Người dùng đã có đơn vị chính là ${unitName} trong thời gian này. Hãy chọn “Không”.` });
        }
        const mismatch = others.find((m) => m.MaDonVi === unitId && !!m.LaDonViChinh !== primary);
        if (mismatch) return invalid({ primary: `Người dùng đã giữ chức vụ khác tại đơn vị này với “Đơn vị chính” = ${mismatch.LaDonViChinh ? 'Có' : 'Không'}. Hãy chọn cùng giá trị.` });

        const params = { personId, unitId, roleId, primary, start: parseYmd(newStart), end: newEnd ? parseYmd(newEnd) : null };
        if (reappoint) {
          await db.exec(
            `UPDATE dbo.ThanhVienDonVi
             SET LaDonViChinh = @primary, NgayThamGia = CONVERT(DATE, @start), NgayKetThuc = CONVERT(DATE, @end), TrangThai = 1
             WHERE MaNguoiDung = @personId AND MaDonVi = @unitId AND MaChucVu = @roleId;`,
            params,
          );
        } else {
          await db.exec(
            `INSERT dbo.ThanhVienDonVi (MaNguoiDung, MaDonVi, MaChucVu, LaDonViChinh, NgayThamGia, NgayKetThuc, TrangThai)
             VALUES (@personId, @unitId, @roleId, @primary, CONVERT(DATE, @start), CONVERT(DATE, @end), 1);`,
            params,
          );
        }
        const dto: MembershipDto = { personId, unitId, roleId, primary, start: newStart, end: newEnd ?? '' };
        await writeAudit(db, userId, reappoint ? 'TaiBoNhiemThanhVien' : 'ThemThanhVien', 'ThanhVienDonVi', `${personId}:${unitId}:${roleId}`,
          reappoint && sameTriple ? membershipDto(sameTriple) : null, dto, ip);
        return ok(dto);
      });
    } catch (e) {
      const n = sqlErrorNumber(e);
      if (n === PRIMARY_UNIT_TRIGGER) return invalid({ primary: 'Đơn vị chính bị trùng hoặc không nhất quán giữa các chức vụ cùng đơn vị.' });
      if (n === UNIQUE_INDEX || n === UNIQUE_CONSTRAINT) return invalid({ roleId: 'Người dùng đã có chức vụ này tại đơn vị. Không thể tạo trùng bộ ba.' });
      throw e;
    }
  }

  async saveRolePermissions(userId: number, roleId: number, values: unknown, ip: string | null): Promise<Result<RoleDto>> {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return invalid({ permissions: 'Thiếu danh sách quyền.' });
    const v = (key: string) => (values as Record<string, unknown>)[key] === true;
    return this.db.tx(userId, async (db) => {
      const actor = await loadActiveUser(db, userId);
      if (!actor) return fail(401, 'Phiên đăng nhập không còn hiệu lực.');
      if (!actor.LaQuanTriHeThong) return fail(403, 'Chỉ quản trị hệ thống được thay đổi quyền của chức vụ.');
      const before = await db.one<RoleRow>(`SELECT ${ROLE_COLUMNS} FROM dbo.ChucVu WITH (UPDLOCK, HOLDLOCK) WHERE MaChucVu = @roleId;`, { roleId });
      if (!before) return fail(404, 'Không tìm thấy chức vụ.');
      // Chỉ nhận các khóa quyền nghiệp vụ đã biết; khóa lạ (ví dụ isSystemAdmin) bị bỏ qua.
      const after: RoleRow = {
        ...before,
        DuocTaoCongViec: v('createTask'), DuocGiaoViec: v('assignTask'), DuocDuyetKetQua: v('approveResult'), DuocDanhGia: v('evaluateResult'),
        DuocXemBaoCaoDonVi: v('viewReport'), DuocQuanLyThanhVien: v('manageMembers'), ApDungChoDonViCon: v('includeChildren'),
      };
      await db.exec(
        `UPDATE dbo.ChucVu
         SET DuocTaoCongViec = @DuocTaoCongViec, DuocGiaoViec = @DuocGiaoViec, DuocDuyetKetQua = @DuocDuyetKetQua, DuocDanhGia = @DuocDanhGia,
             DuocXemBaoCaoDonVi = @DuocXemBaoCaoDonVi, DuocQuanLyThanhVien = @DuocQuanLyThanhVien, ApDungChoDonViCon = @ApDungChoDonViCon
         WHERE MaChucVu = @MaChucVu;`,
        {
          DuocTaoCongViec: after.DuocTaoCongViec, DuocGiaoViec: after.DuocGiaoViec, DuocDuyetKetQua: after.DuocDuyetKetQua, DuocDanhGia: after.DuocDanhGia,
          DuocXemBaoCaoDonVi: after.DuocXemBaoCaoDonVi, DuocQuanLyThanhVien: after.DuocQuanLyThanhVien, ApDungChoDonViCon: after.ApDungChoDonViCon,
          MaChucVu: roleId,
        },
      );
      const oldDto = roleDto(before), newDto = roleDto(after);
      await writeAudit(db, userId, 'CapNhatQuyenChucVu', 'ChucVu', String(roleId), oldDto.permissions, newDto.permissions, ip);
      return ok(newDto);
    });
  }
}
