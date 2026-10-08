import { Injectable } from '@nestjs/common';
import type { CategoryDto, TemplateDto } from '@khoa/shared';
import { DbService, SqlRunner, sqlErrorNumber, typed } from '../db/db.service';
import * as sql from 'mssql';
import { Result, fail, invalid, ok, unauthorized } from '../common/result';
import { writeAudit } from '../common/audit-log';
import { clean, collapseSpaces, cut, initials, toBool, toInt, toStr } from '../common/text';
import { OFFSET_MS, addDays, addMonths, formatDate, parseYmd, todayLocal } from '../common/vn-time';
import { TaskRights, loadRights } from './task-access';
import { N, notify } from './task-support';

const CATEGORY_SQL = `SELECT t.MaTheLoai AS id, t.TenTheLoai AS name, ISNULL(t.MoTa, N'') AS description, t.TrangThai AS active,
         (SELECT COUNT(*) FROM dbo.CongViec AS c WHERE c.MaTheLoai = t.MaTheLoai) AS taskCount
  FROM dbo.TheLoaiCongViec AS t`;

export const categories = (db: SqlRunner): Promise<CategoryDto[]> => db.query<CategoryDto>(`${CATEGORY_SQL} ORDER BY t.TrangThai DESC, t.TenTheLoai;`);

interface TemplateRow {
  MaMau: number; TenMau: string; TieuDe: string; MoTa: string | null; TieuChiHoanThanh: string | null; MaTheLoai: number | null; TenTheLoai: string | null;
  MucDoUuTien: number; MaDonViQuanLy: number; TenDonVi: string; SoNgayThucHien: number; ChuKyLap: number; NgayTaoLanToi: Date | null;
  SoLanDaDung: number; MaNguoiTao: number; TenNguoiTao: string; TrangThai: boolean;
}

const TEMPLATE_SELECT = `SELECT m.MaMau, m.TenMau, m.TieuDe, m.MoTa, m.TieuChiHoanThanh, m.MaTheLoai, tl.TenTheLoai, m.MucDoUuTien,
         m.MaDonViQuanLy, d.TenDonVi, m.SoNgayThucHien, m.ChuKyLap, m.NgayTaoLanToi, m.SoLanDaDung,
         m.MaNguoiTao, n.HoTen AS TenNguoiTao, m.TrangThai
  FROM dbo.MauCongViec AS m
  JOIN dbo.DonVi AS d ON d.MaDonVi = m.MaDonViQuanLy
  JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = m.MaNguoiTao
  LEFT JOIN dbo.TheLoaiCongViec AS tl ON tl.MaTheLoai = m.MaTheLoai`;

const canEditTemplate = (r: TaskRights, t: TemplateRow) => r.isAdmin || t.MaNguoiTao === r.userId || r.createUnits.has(t.MaDonViQuanLy);

const templateDto = (r: TaskRights, t: TemplateRow): TemplateDto => ({
  id: t.MaMau, name: t.TenMau, title: t.TieuDe, description: t.MoTa ?? '', criteria: t.TieuChiHoanThanh ?? '', categoryId: t.MaTheLoai,
  categoryName: t.TenTheLoai ?? '', priority: t.MucDoUuTien, unitId: t.MaDonViQuanLy, unitName: t.TenDonVi, durationDays: t.SoNgayThucHien,
  recurrence: t.ChuKyLap, nextRun: t.NgayTaoLanToi ? formatDate(t.NgayTaoLanToi) : null, timesUsed: t.SoLanDaDung, active: !!t.TrangThai,
  creator: { id: t.MaNguoiTao, name: t.TenNguoiTao, initials: initials(t.TenNguoiTao) }, canEdit: canEditTemplate(r, t),
});

export async function templates(db: SqlRunner, r: TaskRights): Promise<TemplateDto[]> {
  const rows = await db.query<TemplateRow>(
    `${TEMPLATE_SELECT} WHERE @isAdmin = 1 OR m.MaNguoiTao = @me OR m.MaDonViQuanLy IN @units ORDER BY m.TrangThai DESC, m.SoLanDaDung DESC, m.TenMau;`,
    { isAdmin: r.isAdmin, me: r.userId, units: [...new Set([...r.createUnits, ...r.assignUnits])] },
  );
  return rows.map((t) => templateDto(r, t));
}

/**
 * Danh mục phân hệ Công việc:
 *  - Thể loại: chỉ quản trị hệ thống thêm/sửa/ngừng dùng (không xóa để giữ lịch sử).
 *  - Mẫu công việc: người có quyền tạo công việc ở đơn vị của mẫu, hoặc quản trị hệ thống.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly db: DbService) {}

  async saveCategory(userId: number, id: number | null, input: Record<string, unknown>, ip: string | null): Promise<Result<CategoryDto>> {
    const name = collapseSpaces(input.name);
    const description = clean(input.description);
    const active = toBool(input.active);
    const errors: Record<string, string> = {};
    if (!name) errors.name = 'Chưa nhập tên thể loại.';
    else if (name.length > 100) errors.name = 'Tên thể loại tối đa 100 ký tự.';
    if (description.length > 500) errors.description = 'Mô tả tối đa 500 ký tự.';
    if (Object.keys(errors).length) return invalid(errors);
    try {
      return await this.db.tx(userId, async (db) => {
        const admin = await db.scalar<boolean>('SELECT LaQuanTriHeThong FROM dbo.NguoiDung WHERE MaNguoiDung = @userId AND TrangThaiTaiKhoan = 1;', { userId });
        if (admin !== true) return fail(403, 'Chỉ quản trị hệ thống được quản lý thể loại công việc.');
        const duplicate = await db.scalar<number>('SELECT TOP (1) MaTheLoai FROM dbo.TheLoaiCongViec WHERE TenTheLoai = @name AND (@id IS NULL OR MaTheLoai <> @id);', { name, id });
        if (duplicate != null) return invalid({ name: 'Đã có thể loại cùng tên.' });
        let savedId: number;
        if (id != null) {
          const old = await db.one<CategoryDto>(
            "SELECT MaTheLoai AS id, TenTheLoai AS name, ISNULL(MoTa, N'') AS description, TrangThai AS active, 0 AS taskCount FROM dbo.TheLoaiCongViec WITH (UPDLOCK) WHERE MaTheLoai = @id;",
            { id },
          );
          if (!old) return fail(404, 'Không tìm thấy thể loại.');
          const nextActive = active ?? old.active;
          await db.exec('UPDATE dbo.TheLoaiCongViec SET TenTheLoai = @name, MoTa = @description, TrangThai = @active WHERE MaTheLoai = @id;', { name, description: description || null, active: nextActive, id });
          await writeAudit(db, userId, 'SuaTheLoai', 'TheLoaiCongViec', String(id), old, { name, description, active: nextActive }, ip);
          savedId = id;
        } else {
          savedId = (await db.scalar<number>(
            'INSERT dbo.TheLoaiCongViec (TenTheLoai, MoTa, TrangThai) VALUES (@name, @description, @active); SELECT CONVERT(INT, SCOPE_IDENTITY());',
            { name, description: description || null, active: active ?? true },
          ))!;
          await writeAudit(db, userId, 'ThemTheLoai', 'TheLoaiCongViec', String(savedId), null, { name, description }, ip);
        }
        const saved = await db.one<CategoryDto>(`${CATEGORY_SQL} WHERE t.MaTheLoai = @savedId;`, { savedId });
        return ok(saved!);
      });
    } catch (e) {
      const n = sqlErrorNumber(e);
      if (n === 2601 || n === 2627) return invalid({ name: 'Đã có thể loại cùng tên.' });
      throw e;
    }
  }

  saveTemplate(userId: number, id: number | null, input: Record<string, unknown>): Promise<Result<TemplateDto>> {
    return this.db.tx(userId, async (db) => {
      const r = await loadRights(db, userId);
      if (!r) return unauthorized();
      let old: TemplateRow | null = null;
      if (id != null) {
        old = await db.one<TemplateRow>(`${TEMPLATE_SELECT} WHERE m.MaMau = @id;`, { id });
        if (!old) return fail(404, 'Không tìm thấy mẫu.');
        if (!canEditTemplate(r, old)) return fail(403, 'Bạn không có quyền sửa mẫu này.');
      } else if (!r.isAdmin && r.createUnits.size === 0) {
        return fail(403, 'Chức vụ của bạn chưa được cấp quyền tạo công việc.');
      }
      const errors: Record<string, string> = {};
      const name = collapseSpaces(input.name), title = collapseSpaces(input.title);
      if (!name) errors.name = 'Chưa nhập tên mẫu.';
      else if (name.length > 150) errors.name = 'Tên mẫu tối đa 150 ký tự.';
      if (!title) errors.title = 'Chưa nhập tiêu đề công việc.';
      else if (title.length > 250) errors.title = 'Tiêu đề tối đa 250 ký tự.';
      const description = clean(input.description), criteria = clean(input.criteria);
      if (description.length > 10000) errors.description = 'Mô tả tối đa 10.000 ký tự.';
      if (criteria.length > 4000) errors.criteria = 'Tiêu chí tối đa 4.000 ký tự.';
      const priority = toInt(input.priority) ?? 2;
      if (priority < 1 || priority > 4) errors.priority = 'Mức ưu tiên không hợp lệ.';
      const duration = toInt(input.durationDays) ?? 14;
      if (duration < 1 || duration > 365) errors.durationDays = 'Số ngày thực hiện từ 1 đến 365.';
      const recurrence = toInt(input.recurrence) ?? 0;
      if (recurrence < 0 || recurrence > 2) errors.recurrence = 'Chu kỳ lặp không hợp lệ.';
      const unitId = toInt(input.unitId);
      if (unitId == null) errors.unitId = 'Chọn đơn vị quản lý.';
      else if (!r.isAdmin && !r.createUnits.has(unitId) && unitId !== old?.MaDonViQuanLy) errors.unitId = 'Bạn không có quyền tạo công việc cho đơn vị này.';
      const categoryId = toInt(input.categoryId);
      if (categoryId != null && (await db.scalar<number>('SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.TheLoaiCongViec WHERE MaTheLoai = @cat AND TrangThai = 1) THEN 1 ELSE 0 END;', { cat: categoryId })) !== 1)
        errors.categoryId = 'Thể loại không còn hoạt động.';
      let nextRun: Date | null = null;
      if (recurrence > 0) {
        const nr = parseYmd(toStr(input.nextRun));
        if (!nr) errors.nextRun = 'Chọn ngày tạo lần tới cho việc lặp lại.';
        else if (nr < todayLocal() && formatDate(nr) !== (old?.NgayTaoLanToi ? formatDate(old.NgayTaoLanToi) : '')) errors.nextRun = 'Ngày tạo lần tới đã qua.';
        else nextRun = nr;
      }
      if (Object.keys(errors).length) return invalid(errors);
      const args = {
        name, title, description: description || null, criteria: criteria || null, categoryId, priority, unitId, duration, recurrence,
        nextRun: typed(sql.Date, nextRun), active: toBool(input.active) ?? (old ? !!old.TrangThai : true), userId, id,
      };
      let savedId: number;
      if (old) {
        await db.exec(
          `UPDATE dbo.MauCongViec SET TenMau = @name, TieuDe = @title, MoTa = @description, TieuChiHoanThanh = @criteria,
               MaTheLoai = @categoryId, MucDoUuTien = @priority, MaDonViQuanLy = @unitId, SoNgayThucHien = @duration,
               ChuKyLap = @recurrence, NgayTaoLanToi = @nextRun, TrangThai = @active
           WHERE MaMau = @id;`,
          args,
        );
        savedId = old.MaMau;
      } else {
        savedId = (await db.scalar<number>(
          `INSERT dbo.MauCongViec (TenMau, TieuDe, MoTa, TieuChiHoanThanh, MaTheLoai, MucDoUuTien, MaDonViQuanLy,
                                   SoNgayThucHien, ChuKyLap, NgayTaoLanToi, MaNguoiTao, TrangThai)
           VALUES (@name, @title, @description, @criteria, @categoryId, @priority, @unitId, @duration, @recurrence, @nextRun, @userId, @active);
           SELECT CONVERT(INT, SCOPE_IDENTITY());`,
          args,
        ))!;
      }
      const row = await db.one<TemplateRow>(`${TEMPLATE_SELECT} WHERE m.MaMau = @savedId;`, { savedId });
      return ok(templateDto(r, row!));
    });
  }

  /**
   * Xóa mẫu công việc (cùng quyền với sửa mẫu). Công việc đã tạo từ mẫu được giữ nguyên,
   * chỉ bỏ liên kết CongViec.MaMauCongViec. Trả số công việc đã gỡ liên kết.
   */
  deleteTemplate(userId: number, id: number, ip: string | null): Promise<Result<{ unlinkedTasks: number }>> {
    return this.db.tx(userId, async (db) => {
      const r = await loadRights(db, userId);
      if (!r) return unauthorized();
      const locked = TEMPLATE_SELECT.replace('FROM dbo.MauCongViec AS m', 'FROM dbo.MauCongViec AS m WITH (UPDLOCK, HOLDLOCK)');
      const old = await db.one<TemplateRow>(`${locked} WHERE m.MaMau = @id;`, { id });
      if (!old) return fail(404, 'Không tìm thấy mẫu.');
      if (!canEditTemplate(r, old)) return fail(403, 'Bạn không có quyền xóa mẫu này.');
      const unlinkedTasks = await db.exec('UPDATE dbo.CongViec SET MaMauCongViec = NULL WHERE MaMauCongViec = @id;', { id });
      await db.exec('DELETE FROM dbo.MauCongViec WHERE MaMau = @id;', { id });
      await writeAudit(db, userId, 'XoaMauCongViec', 'MauCongViec', String(id),
        { name: old.TenMau, title: old.TieuDe, unitId: old.MaDonViQuanLy, recurrence: old.ChuKyLap, timesUsed: old.SoLanDaDung }, { unlinkedTasks }, ip);
      return ok({ unlinkedTasks });
    });
  }
}

/**
 * Tạo bản NHÁP cho các mẫu lặp lại đã đến ngày; gửi thông báo "cần xử lý" cho người tạo mẫu để xác nhận.
 * Không tự giao việc. Trả số bản nháp đã tạo.
 */
export async function runRecurrence(db: DbService): Promise<number> {
  const today = todayLocal();
  const due = await db.read((r) =>
    r.query<TemplateRow>(`${TEMPLATE_SELECT} WHERE m.TrangThai = 1 AND m.ChuKyLap > 0 AND m.NgayTaoLanToi <= @today AND n.TrangThaiTaiKhoan = 1;`, { today: typed(sql.Date, today) }),
  );
  let created = 0;
  for (const t of due) {
    const made = await db.tx(null, async (tx) => {
      // Khóa mẫu và kiểm tra lại (tránh hai tiến trình cùng tạo).
      const next = await tx.scalar<Date>('SELECT NgayTaoLanToi FROM dbo.MauCongViec WITH (UPDLOCK, HOLDLOCK) WHERE MaMau = @id AND TrangThai = 1 AND ChuKyLap > 0;', { id: t.MaMau });
      if (!next || next > today) return 0;
      const runDay = next; // ngày thuần 00:00 UTC
      const start = new Date(runDay.getTime() - OFFSET_MS);
      const deadline = new Date(addDays(runDay, t.SoNgayThucHien + 1).getTime() - 1000 - OFFSET_MS);
      await tx.exec("EXEC sys.sp_set_session_context @key = N'MaNguoiDung', @value = @uid;", { uid: typed(sql.Int, t.MaNguoiTao) });
      const [y, m] = formatDate(runDay).split('-');
      const taskId = (await tx.scalar<number>(
        `INSERT dbo.CongViec (TieuDe, MoTa, TieuChiHoanThanh, NgayBatDau, HanHoanThanh, TrangThai, MucDoUuTien,
                              MaNguoiTao, MaDonViQuanLy, MaTheLoai, MaMauCongViec)
         VALUES (@title, @description, @criteria, @start, @deadline, 0, @priority, @creator, @unit, @category, @id);
         SELECT CONVERT(INT, SCOPE_IDENTITY());`,
        { title: cut(`${t.TieuDe} (${m}/${y})`, 250), description: t.MoTa, criteria: t.TieuChiHoanThanh, start, deadline, priority: t.MucDoUuTien, creator: t.MaNguoiTao, unit: t.MaDonViQuanLy, category: t.MaTheLoai, id: t.MaMau },
      ))!;
      const following = t.ChuKyLap === 1 ? addMonths(runDay, 6) : addMonths(runDay, 12);
      await tx.exec('UPDATE dbo.MauCongViec SET NgayTaoLanToi = @following, SoLanDaDung = SoLanDaDung + 1 WHERE MaMau = @id;', { following: typed(sql.Date, following), id: t.MaMau });
      const [dy, dm, dd] = formatDate(addDays(runDay, t.SoNgayThucHien)).split('-');
      await notify(tx, [t.MaNguoiTao], taskId, N.Recurrence, 0, `Đến kỳ lặp lại: ${t.TenMau}`,
        `Đã tạo bản nháp “${t.TieuDe}”, hạn ${dd}/${dm}/${dy}. Kiểm tra rồi bấm Tạo chính thức để giao việc.`, true);
      await tx.exec("EXEC sys.sp_set_session_context @key = N'MaNguoiDung', @value = NULL;");
      return 1;
    });
    created += made;
  }
  return created;
}
