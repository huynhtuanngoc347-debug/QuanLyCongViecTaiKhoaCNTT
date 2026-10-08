import type { MembershipDto, OrganizationDto, PersonDto, ProfileDto, RoleDto, UnitDto } from '@khoa/shared';
import type { SqlRunner } from '../db/db.service';
import {
  MEMBERSHIP_COLUMNS, PERSON_COLUMNS, ROLE_COLUMNS, UNIT_COLUMNS, membershipDto, personDto, roleDto, unitDto,
  type MembershipRow, type PersonRow, type RoleRow, type UnitRow,
} from '../common/mapping';
import { normalize } from '../common/text';

/** Truy vấn chỉ đọc cho các màn hình tổ chức. Không bao giờ chọn cột MatKhauBam. */

export async function loadAll(db: SqlRunner): Promise<OrganizationDto> {
  const [units, people, roles, memberships] = await db.multi(
    `SELECT ${UNIT_COLUMNS} FROM dbo.DonVi ORDER BY CASE WHEN MaDonViCha IS NULL THEN 0 ELSE 1 END, TenDonVi;
     SELECT ${PERSON_COLUMNS} FROM dbo.NguoiDung ORDER BY HoTen, MaNguoiDung;
     SELECT ${ROLE_COLUMNS} FROM dbo.ChucVu ORDER BY MaChucVu;
     SELECT ${MEMBERSHIP_COLUMNS} FROM dbo.ThanhVienDonVi WHERE TrangThai = 1
     ORDER BY MaDonVi, LaDonViChinh DESC, MaChucVu, MaNguoiDung;`,
  );
  return {
    units: (units as unknown as UnitRow[]).map(unitDto),
    people: (people as unknown as PersonRow[]).map(personDto),
    roles: (roles as unknown as RoleRow[]).map(roleDto),
    memberships: (memberships as unknown as MembershipRow[]).map(membershipDto),
  };
}

export async function units(db: SqlRunner): Promise<UnitDto[]> {
  return (await db.query<UnitRow>(`SELECT ${UNIT_COLUMNS} FROM dbo.DonVi ORDER BY CASE WHEN MaDonViCha IS NULL THEN 0 ELSE 1 END, TenDonVi;`)).map(unitDto);
}

export async function unit(db: SqlRunner, id: number): Promise<UnitDto | null> {
  const row = await db.one<UnitRow>(`SELECT ${UNIT_COLUMNS} FROM dbo.DonVi WHERE MaDonVi = @id;`, { id });
  return row ? unitDto(row) : null;
}

/** Thành viên hiện tại của một đơn vị (đang hiệu lực hôm nay, tính cả ngày kết thúc). */
export async function currentMembers(db: SqlRunner, unitId: number): Promise<MembershipDto[]> {
  return (
    await db.query<MembershipRow>(
      `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
       SELECT ${MEMBERSHIP_COLUMNS} FROM dbo.ThanhVienDonVi
       WHERE MaDonVi = @unitId AND TrangThai = 1
         AND NgayThamGia <= @HomNay AND (NgayKetThuc IS NULL OR NgayKetThuc >= @HomNay)
       ORDER BY LaDonViChinh DESC, MaChucVu, MaNguoiDung;`,
      { unitId },
    )
  ).map(membershipDto);
}

/** Danh sách nhân sự có lọc (tìm không dấu tên/email/mã, đơn vị, trạng thái active|inactive). */
export async function people(db: SqlRunner, search: string | null, unitId: number | null, status: string | null): Promise<PersonDto[]> {
  const active = status === 'active' ? true : status === 'inactive' ? false : null;
  const rows = await db.query<PersonRow>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT ${PERSON_COLUMNS} FROM dbo.NguoiDung AS n
     WHERE (@active IS NULL OR n.TrangThaiTaiKhoan = @active)
       AND (@unitId IS NULL OR EXISTS (
             SELECT 1 FROM dbo.ThanhVienDonVi AS tv
             WHERE tv.MaNguoiDung = n.MaNguoiDung AND tv.MaDonVi = @unitId AND tv.TrangThai = 1
               AND tv.NgayThamGia <= @HomNay AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay)))
     ORDER BY n.HoTen, n.MaNguoiDung;`,
    { active, unitId },
  );
  let list = rows.map(personDto);
  if (search && search.trim()) {
    const q = normalize(search);
    list = list.filter((p) => normalize(`${p.name} ${p.email} ${p.employeeCode}`).includes(q));
  }
  return list;
}

export async function profile(db: SqlRunner, personId: number): Promise<ProfileDto | null> {
  const [persons, memberships] = await db.multi(
    `SELECT ${PERSON_COLUMNS} FROM dbo.NguoiDung WHERE MaNguoiDung = @personId;
     SELECT ${MEMBERSHIP_COLUMNS} FROM dbo.ThanhVienDonVi
     WHERE MaNguoiDung = @personId AND TrangThai = 1
     ORDER BY LaDonViChinh DESC, NgayThamGia, MaDonVi;`,
    { personId },
  );
  const person = (persons as unknown as PersonRow[])[0];
  if (!person) return null;
  return { person: personDto(person), memberships: (memberships as unknown as MembershipRow[]).map(membershipDto) };
}

export async function roles(db: SqlRunner): Promise<RoleDto[]> {
  return (await db.query<RoleRow>(`SELECT ${ROLE_COLUMNS} FROM dbo.ChucVu ORDER BY MaChucVu;`)).map(roleDto);
}
