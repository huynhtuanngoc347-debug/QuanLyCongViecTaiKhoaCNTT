import { Injectable } from '@nestjs/common';
import { DbService, SqlRunner, sqlErrorNumber } from '../db/db.service';
import { Result, conflict, fail, forbidden, invalid, invalidField, notFound, ok, unauthorized } from '../common/result';
import { clean, collapseSpaces, cut, formatDecimal, toBool, toInt, toIntList, toNumber, toStr } from '../common/text';
import { DAY_MS, OFFSET_MS, addMonths, localText, nowUtc, parseVnDate, todayLocal } from '../common/vn-time';
import { TaskRights, loadRights, unitManagers } from './task-access';
import * as P from './task-policy';
import type { AssignmentRow, ExtensionRow, TaskRow } from './task-policy';
import { N, UploadedFile, FILE_PREFIX, logHistory, markHandled, notify, safeFileName, tryDelete, validateFiles } from './task-support';
import * as path from 'node:path';

const NOT_FOUND_TASK = 'Không tìm thấy công việc hoặc bạn không có quyền xem.';
const CYCLE_ERRORS = [51002, 51004];

const lockTask = (db: SqlRunner, taskId: number) =>
  db.one<TaskRow>(
    `SELECT ${P.TASK_COLUMNS}
     FROM dbo.CongViec AS cv WITH (UPDLOCK, HOLDLOCK)
     JOIN dbo.NguoiDung AS nt ON nt.MaNguoiDung = cv.MaNguoiTao
     JOIN dbo.DonVi AS dv ON dv.MaDonVi = cv.MaDonViQuanLy
     LEFT JOIN dbo.TheLoaiCongViec AS tl ON tl.MaTheLoai = cv.MaTheLoai
     WHERE cv.MaCongViec = @taskId;`,
    { taskId },
  );

const lockAssignment = (db: SqlRunner, assignmentId: number) =>
  db.one<AssignmentRow>(`SELECT ${P.ASSIGNMENT_COLUMNS} ${P.assignmentFrom(true)} WHERE p.MaPhanCong = @assignmentId;`, { assignmentId });

const assignmentsOf = (db: SqlRunner, taskId: number) =>
  db.query<AssignmentRow>(`SELECT ${P.ASSIGNMENT_COLUMNS} ${P.assignmentFrom()} WHERE p.MaCongViec = @taskId;`, { taskId });

interface Ctx { rights: TaskRights; task: TaskRow; assignment: AssignmentRow; }

/** Tải phân công + công việc + quyền; trả lỗi nếu không thấy. */
async function loadAssignmentContext(db: SqlRunner, userId: number, assignmentId: number): Promise<Result<Ctx>> {
  const rights = await loadRights(db, userId);
  if (!rights) return unauthorized();
  const assignment = await lockAssignment(db, assignmentId);
  if (!assignment) return notFound('Không tìm thấy phân công.');
  const task = await lockTask(db, assignment.MaCongViec);
  if (!task) return notFound('Không tìm thấy công việc.');
  return { kind: 'ok', value: { rights, task, assignment } };
}

const setTaskStatus = (db: SqlRunner, taskId: number, status: number) =>
  db.exec('UPDATE dbo.CongViec SET TrangThai = @status WHERE MaCongViec = @taskId AND TrangThai <> @status;', { taskId, status });

/**
 * Cập nhật tiến độ tổng (trung bình báo cáo gần nhất của các phân công còn hiệu lực) và trạng thái tự động:
 * Chưa bắt đầu → Đang thực hiện khi có người nhận/báo cáo; → Chờ duyệt khi mọi phân công đã nộp/được duyệt.
 * Không tự đóng Hoàn thành: người quản lý đóng bằng thao tác riêng.
 */
async function syncTask(db: SqlRunner, taskId: number): Promise<void> {
  const t = await lockTask(db, taskId);
  if (!t || !P.isRunning(t)) return;
  const active = (await assignmentsOf(db, taskId)).filter(P.isActive);
  if (active.length === 0) return;
  let progress = Math.round((active.reduce((s, a) => s + Number(a.PhanTramBaoCao), 0) / active.length) * 100) / 100;
  if (progress > 100) progress = 100;
  if (progress >= 100 && active.some((a) => a.TrangThaiPhanCong !== P.AsDone)) progress = 99;
  const started = active.some((a) => [P.AsAccepted, P.AsWorking, P.AsReview, P.AsDone].includes(a.TrangThaiPhanCong));
  const allSubmitted = active.every((a) => a.TrangThaiPhanCong === P.AsReview || a.TrangThaiPhanCong === P.AsDone);
  const status = allSubmitted ? P.Review : started ? P.InProgress : P.NotStarted;
  if (status !== t.TrangThai || progress !== Number(t.PhanTramTienDo)) {
    await db.exec('UPDATE dbo.CongViec SET TrangThai = @status, PhanTramTienDo = @progress WHERE MaCongViec = @taskId;', { status, progress, taskId });
  }
}

/**
 * Đóng công việc là Hoàn thành khi mọi phân công còn hiệu lực đã được duyệt Đạt và không còn công việc con đang mở.
 * Trả lý do chưa đóng được (null khi đã đóng). Dùng cho nút "Đóng: Hoàn thành" và tự đóng khi duyệt Đạt phân công cuối.
 */
async function completeTask(db: SqlRunner, t: TaskRow, assignments: AssignmentRow[]): Promise<string | null> {
  const active = assignments.filter(P.isActive);
  if (t.TrangThai !== P.InProgress && t.TrangThai !== P.Review) return 'Chỉ đóng được công việc đang thực hiện hoặc chờ duyệt.';
  if (active.length === 0) return 'Công việc chưa có phân công nào hoàn thành.';
  if (active.some((a) => a.TrangThaiPhanCong !== P.AsDone)) return 'Còn phân công chưa được duyệt Đạt. Duyệt hoặc hủy các phân công đó trước.';
  const openChild = await db.scalar<string>('SELECT TOP (1) TieuDe FROM dbo.CongViec WHERE MaCongViecCha = @taskId AND TrangThai IN (1, 2, 3, 5);', { taskId: t.MaCongViec });
  if (openChild) return `Công việc con “${openChild}” chưa xong. Hoàn thành hoặc hủy công việc con trước.`;
  await db.exec(
    `UPDATE dbo.CongViec
     SET TrangThai = 4, PhanTramTienDo = 100,
         NgayHoanThanh = CASE WHEN NgayBatDau IS NOT NULL AND NgayBatDau > SYSUTCDATETIME() THEN NgayBatDau ELSE SYSUTCDATETIME() END
     WHERE MaCongViec = @taskId;`,
    { taskId: t.MaCongViec },
  );
  return null;
}

const declineTableReady = async (db: SqlRunner) => !!(await db.scalar<number>(`SELECT CASE WHEN ${P.HAS_DECLINE_TABLE} THEN 1 ELSE 0 END;`));

/** Đóng các yêu cầu xin từ chối còn chờ khi phân công/công việc bị hủy (bỏ qua nếu chưa chạy 04_XinTuChoi.sql). */
const closePendingDeclines = (db: SqlRunner, userId: number, note: string, where: string, params: Record<string, unknown>) =>
  db.exec(
    `IF ${P.HAS_DECLINE_TABLE}
       UPDATE dbo.YeuCauTuChoi SET TrangThai = 2, MaNguoiDuyet = @userId, NgayDuyet = SYSUTCDATETIME(), NhanXet = @note
       WHERE TrangThai = 0 AND ${where};`,
    { ...params, userId, note },
  );

const dependencyBlocker = (db: SqlRunner, taskId: number) =>
  db.scalar<string>(
    `SELECT TOP (1) c.TieuDe
     FROM dbo.PhuThuocCongViec AS d JOIN dbo.CongViec AS c ON c.MaCongViec = d.MaCongViecTruoc
     WHERE d.MaCongViecSau = @taskId AND c.TrangThai NOT IN (4, 6)
     ORDER BY c.HanHoanThanh;`,
    { taskId },
  );

async function saveDependencies(db: SqlRunner, taskId: number, dependsOn: number[]): Promise<void> {
  await db.exec('DELETE FROM dbo.PhuThuocCongViec WHERE MaCongViecSau = @taskId AND MaCongViecTruoc NOT IN @keep;', { taskId, keep: dependsOn.length ? dependsOn : [0] });
  for (const dep of dependsOn) {
    await db.exec(
      `IF NOT EXISTS (SELECT 1 FROM dbo.PhuThuocCongViec WHERE MaCongViecTruoc = @dep AND MaCongViecSau = @taskId)
           INSERT dbo.PhuThuocCongViec (MaCongViecTruoc, MaCongViecSau, MoTa) VALUES (@dep, @taskId, N'Phải xong trước');`,
      { dep, taskId },
    );
  }
}

interface Prepared {
  title: string; description: string | null; criteria: string | null; categoryId: number | null; priority: number;
  start: Date | null; due: Date | null; unitId: number; parentId: number | null; dependsOn: number[]; draft: boolean;
}

async function validateTask(db: SqlRunner, rights: TaskRights, input: Record<string, unknown>, editingTaskId: number | null, allowedUnits: Set<number>, draft: boolean): Promise<{ value: Prepared | null; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const p: Prepared = { title: '', description: null, criteria: null, categoryId: null, priority: 2, start: null, due: null, unitId: 0, parentId: null, dependsOn: [], draft };
  p.title = collapseSpaces(input.title);
  if (p.title.length === 0) errors.title = 'Chưa nhập tiêu đề công việc.';
  else if (p.title.length > 250) errors.title = `Tiêu đề dài ${p.title.length} ký tự; tối đa 250 ký tự.`;
  const d = clean(input.description); p.description = d.length ? d : null;
  if (p.description && p.description.length > 10000) errors.description = 'Mô tả tối đa 10.000 ký tự.';
  const c = clean(input.criteria); p.criteria = c.length ? c : null;
  if (p.criteria && p.criteria.length > 4000) errors.criteria = 'Tiêu chí hoàn thành tối đa 4.000 ký tự.';

  const pr = toInt(input.priority);
  if (pr != null) {
    if (pr < 1 || pr > 4) errors.priority = 'Chọn mức ưu tiên: Thấp, Bình thường, Cao hoặc Khẩn cấp.';
    else p.priority = pr;
  }
  const cat = toInt(input.categoryId);
  if (cat != null) {
    const okCat = await db.scalar<number>('SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.TheLoaiCongViec WHERE MaTheLoai = @cat AND TrangThai = 1) THEN 1 ELSE 0 END;', { cat });
    if (okCat !== 1) errors.categoryId = 'Thể loại không còn hoạt động. Chọn thể loại khác.';
    else p.categoryId = cat;
  } else if (!draft) errors.categoryId = 'Chưa chọn thể loại công việc.';

  const startText = toStr(input.start), dueText = toStr(input.due);
  if (startText && startText.trim()) {
    p.start = parseVnDate(startText, false);
    if (!p.start) errors.start = 'Ngày bắt đầu không hợp lệ.';
  }
  if (dueText && dueText.trim()) {
    p.due = parseVnDate(dueText, true);
    if (!p.due) errors.due = 'Hạn hoàn thành không hợp lệ.';
  } else if (!draft) errors.due = 'Chưa nhập hạn hoàn thành.';
  if (p.start && p.due && p.due < p.start) errors.due = 'Hạn hoàn thành phải từ ngày bắt đầu trở đi.';
  if (editingTaskId == null && !draft && p.due && p.due < nowUtc()) errors.due = 'Hạn hoàn thành đã qua. Chọn từ hôm nay trở đi.';

  const unitId = toInt(input.unitId);
  if (unitId == null) errors.unitId = 'Chưa chọn đơn vị quản lý.';
  else if (!allowedUnits.has(unitId)) errors.unitId = 'Bạn không có quyền tạo công việc cho đơn vị này.';
  else p.unitId = unitId;

  const parentId = toInt(input.parentId);
  if (parentId != null) {
    if (parentId === editingTaskId) errors.parentId = 'Công việc không thể là cha của chính nó.';
    else {
      const parentUnit = await db.scalar<number>('SELECT MaDonViQuanLy FROM dbo.CongViec WHERE MaCongViec = @parentId AND TrangThai NOT IN (0, 6);', { parentId });
      if (parentUnit == null) errors.parentId = 'Công việc cha không tồn tại hoặc đã hủy.';
      else if (!rights.canSeeUnit(parentUnit)) errors.parentId = 'Bạn không có quyền với công việc cha đã chọn.';
      else p.parentId = parentId;
    }
  }
  for (const dep of [...new Set(toIntList(input.dependsOn))]) {
    if (dep === editingTaskId) { errors.dependsOn = 'Công việc không thể phụ thuộc vào chính nó.'; break; }
    const depUnit = await db.scalar<number>('SELECT MaDonViQuanLy FROM dbo.CongViec WHERE MaCongViec = @dep AND TrangThai NOT IN (0, 6);', { dep });
    if (depUnit == null) { errors.dependsOn = `Công việc mã ${dep} không tồn tại hoặc đã hủy.`; break; }
    p.dependsOn.push(dep);
  }
  return { value: Object.keys(errors).length === 0 ? p : null, errors };
}

/** Phạm vi đơn vị người này được giao việc: quyền giao việc, cộng đơn vị có quyền tạo nếu là người tạo công việc. */
function assignScope(rights: TaskRights, t: TaskRow): Set<number> {
  const scope = new Set(rights.assignUnits);
  if (t.MaNguoiTao === rights.userId) rights.createUnits.forEach((u) => scope.add(u));
  return scope;
}

const roleText = (role: number | null) => (role === 1 ? ' (chủ trì)' : role === 2 ? ' (phối hợp)' : '');

/**
 * Thao tác ghi của phân hệ Công việc. Mỗi hàm: mở giao dịch (SESSION_CONTEXT = người thao tác),
 * khóa bản ghi, đọc lại quyền, kiểm tra dữ liệu (lỗi tiếng Việt theo trường), ghi dữ liệu + lịch sử + thông báo trong cùng giao dịch.
 * Thời điểm luôn lấy bằng SYSUTCDATETIME() phía SQL để thỏa các CHECK so sánh ngày.
 */
@Injectable()
export class TaskCommands {
  constructor(private readonly db: DbService) {}

  // ---------- Tạo / sửa công việc ----------
  async create(userId: number, input: Record<string, unknown>): Promise<Result<number>> {
    try {
      return await this.db.tx(userId, async (db) => {
        const rights = await loadRights(db, userId);
        if (!rights) return unauthorized();
        if (rights.createUnits.size === 0) return forbidden('Chức vụ của bạn chưa được cấp quyền tạo công việc.');
        const draft = toBool(input.draft) === true;
        const { value: p, errors } = await validateTask(db, rights, input, null, rights.createUnits, draft);
        if (!p) return invalid(errors);

        let templateId: number | null = null;
        const tpl = toInt(input.templateId);
        if (tpl != null && (await db.scalar<number>('SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.MauCongViec WHERE MaMau = @tpl) THEN 1 ELSE 0 END;', { tpl })) === 1) {
          templateId = tpl;
          await db.exec('UPDATE dbo.MauCongViec SET SoLanDaDung = SoLanDaDung + 1 WHERE MaMau = @tpl;', { tpl });
        }
        const id = (await db.scalar<number>(
          `INSERT dbo.CongViec (TieuDe, MoTa, TieuChiHoanThanh, NgayBatDau, HanHoanThanh, TrangThai, MucDoUuTien,
                                MaNguoiTao, MaDonViQuanLy, MaTheLoai, MaCongViecCha, MaMauCongViec)
           VALUES (@title, @description, @criteria, @start, @due, @status, @priority, @userId, @unitId, @categoryId, @parentId, @templateId);
           SELECT CONVERT(INT, SCOPE_IDENTITY());`,
          { title: p.title, description: p.description, criteria: p.criteria, start: p.start, due: p.due, status: draft ? P.Draft : P.NotStarted, priority: p.priority, userId, unitId: p.unitId, categoryId: p.categoryId, parentId: p.parentId, templateId },
        ))!;
        await saveDependencies(db, id, p.dependsOn);

        if (toBool(input.saveAsTemplate) === true) {
          const r0 = toInt(input.recurrence);
          const recurrence = r0 != null && r0 >= 0 && r0 <= 2 ? r0 : 0;
          const duration = p.start && p.due ? Math.min(365, Math.max(1, Math.ceil((p.due.getTime() - p.start.getTime()) / DAY_MS))) : 14;
          const baseDay = p.start ? new Date(new Date(p.start.getTime() + OFFSET_MS).toISOString().slice(0, 10) + 'T00:00:00Z') : todayLocal();
          const next = recurrence === 1 ? addMonths(baseDay, 6) : recurrence === 2 ? addMonths(baseDay, 12) : null;
          const newTemplate = await db.scalar<number>(
            `INSERT dbo.MauCongViec (TenMau, TieuDe, MoTa, TieuChiHoanThanh, MaTheLoai, MucDoUuTien, MaDonViQuanLy,
                                     SoNgayThucHien, ChuKyLap, NgayTaoLanToi, SoLanDaDung, MaNguoiTao)
             VALUES (@name, @title, @description, @criteria, @categoryId, @priority, @unitId, @duration, @recurrence, CONVERT(DATE, @next), 1, @userId);
             SELECT CONVERT(INT, SCOPE_IDENTITY());`,
            { name: cut(p.title, 150), title: p.title, description: p.description, criteria: p.criteria, categoryId: p.categoryId, priority: p.priority, unitId: p.unitId, duration, recurrence, next, userId },
          );
          await db.exec('UPDATE dbo.CongViec SET MaMauCongViec = @newTemplate WHERE MaCongViec = @id AND MaMauCongViec IS NULL;', { newTemplate, id });
        }
        return ok(id);
      });
    } catch (e) {
      if (CYCLE_ERRORS.includes(sqlErrorNumber(e) ?? 0)) return invalidField('parentId', 'Quan hệ cha–con hoặc phụ thuộc tạo vòng lặp. Chọn công việc khác.');
      throw e;
    }
  }

  async update(userId: number, taskId: number, input: Record<string, unknown>): Promise<Result<number>> {
    try {
      return await this.db.tx(userId, async (db) => {
        const rights = await loadRights(db, userId);
        if (!rights) return unauthorized();
        const t = await lockTask(db, taskId);
        if (!t) return notFound(NOT_FOUND_TASK);
        if (!P.canManage(rights, t)) return forbidden('Chỉ người tạo hoặc người có quyền giao việc ở đơn vị quản lý được sửa công việc.');
        if (t.TrangThai === P.Done || t.TrangThai === P.Cancelled) return conflict('Công việc đã hoàn thành hoặc đã hủy, không sửa được.');
        // Đơn vị quản lý mới phải nằm trong phạm vi quyền; giữ nguyên đơn vị cũ luôn hợp lệ.
        const allowed = new Set([...rights.createUnits, ...rights.assignUnits, t.MaDonViQuanLy]);
        const { value: p, errors } = await validateTask(db, rights, input, taskId, allowed, t.TrangThai === P.Draft);
        if (!p) return invalid(errors);
        // Hạn chung không được sớm hơn hạn riêng của phân công đang mở.
        const latestAssignmentDue = await db.scalar<Date>('SELECT MAX(HanHoanThanh) FROM dbo.PhanCong WHERE MaCongViec = @taskId AND TrangThaiPhanCong IN (0, 1, 2, 3);', { taskId });
        if (p.due && latestAssignmentDue && p.due < latestAssignmentDue)
          return invalidField('due', `Đang có phân công hạn ${localText(latestAssignmentDue)}. Hạn chung phải từ ngày đó trở đi, hoặc sửa hạn phân công trước.`);
        await db.exec(
          `UPDATE dbo.CongViec
           SET TieuDe = @title, MoTa = @description, TieuChiHoanThanh = @criteria, NgayBatDau = @start, HanHoanThanh = @due,
               MucDoUuTien = @priority, MaDonViQuanLy = @unitId, MaTheLoai = @categoryId, MaCongViecCha = @parentId
           WHERE MaCongViec = @taskId;`,
          { title: p.title, description: p.description, criteria: p.criteria, start: p.start, due: p.due, priority: p.priority, unitId: p.unitId, categoryId: p.categoryId, parentId: p.parentId, taskId },
        );
        await saveDependencies(db, taskId, p.dependsOn);
        return ok(taskId);
      });
    } catch (e) {
      if (CYCLE_ERRORS.includes(sqlErrorNumber(e) ?? 0)) return invalidField('parentId', 'Quan hệ cha–con hoặc phụ thuộc tạo vòng lặp. Chọn công việc khác.');
      throw e;
    }
  }

  /** publish | pause | resume | cancel | complete. Trigger tự ghi lịch sử thay đổi TrangThai. */
  changeStatus(userId: number, taskId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const rights = await loadRights(db, userId);
      if (!rights) return unauthorized();
      const t = await lockTask(db, taskId);
      if (!t) return notFound(NOT_FOUND_TASK);
      const note = clean(input.note);
      if (note.length > 1000) return invalidField('note', 'Ghi chú tối đa 1.000 ký tự.');
      const assignments = await assignmentsOf(db, taskId);
      const action = clean(input.action).toLowerCase();

      if (action === 'publish') {
        if (t.MaNguoiTao !== userId) return forbidden('Chỉ người tạo bản nháp được tạo chính thức.');
        if (t.TrangThai !== P.Draft) return conflict('Công việc không còn là bản nháp.');
        const errors: Record<string, string> = {};
        if (t.MaTheLoai == null) errors.categoryId = 'Chọn thể loại trước khi tạo chính thức.';
        if (t.HanHoanThanh == null) errors.due = 'Nhập hạn hoàn thành trước khi tạo chính thức.';
        else if (t.HanHoanThanh < nowUtc()) errors.due = 'Hạn hoàn thành đã qua. Sửa hạn rồi tạo chính thức.';
        if (!rights.createUnits.has(t.MaDonViQuanLy)) errors.unitId = 'Bạn không còn quyền tạo công việc cho đơn vị này.';
        if (Object.keys(errors).length) return invalid(errors);
        await setTaskStatus(db, taskId, P.NotStarted);
        await markHandled(db, userId, taskId, N.Recurrence);
        return ok(taskId);
      }
      if (!P.canManage(rights, t)) return forbidden('Chỉ người tạo hoặc người có quyền giao việc ở đơn vị quản lý được đổi trạng thái công việc.');
      const recipients = assignments.filter(P.isActive).filter((a) => a.MaNguoiNhan != null).map((a) => a.MaNguoiNhan!);
      switch (action) {
        case 'pause':
          if (!P.isRunning(t)) return conflict('Chỉ tạm dừng được công việc đang diễn ra.');
          await setTaskStatus(db, taskId, P.Paused);
          await notify(db, recipients, taskId, N.System, 0, `Tạm dừng: ${t.TieuDe}`, note ? `Lý do: ${note}` : 'Công việc tạm dừng; chưa cần cập nhật tiến độ.', false, userId);
          break;
        case 'resume': {
          if (t.TrangThai !== P.Paused) return conflict('Công việc không ở trạng thái tạm dừng.');
          const started = assignments.some((a) => [P.AsAccepted, P.AsWorking, P.AsReview, P.AsDone].includes(a.TrangThaiPhanCong));
          await setTaskStatus(db, taskId, started ? P.InProgress : P.NotStarted);
          await syncTask(db, taskId);
          await notify(db, recipients, taskId, N.System, 0, `Tiếp tục: ${t.TieuDe}`, 'Công việc đã được tiếp tục.', false, userId);
          break;
        }
        case 'cancel':
          if (t.TrangThai === P.Done || t.TrangThai === P.Cancelled) return conflict('Công việc đã hoàn thành hoặc đã hủy.');
          if (!note) return invalidField('note', 'Nhập lý do hủy công việc.');
          await db.exec(
            `UPDATE dbo.YeuCauGiaHan SET TrangThai = 3, MaNguoiDuyet = @userId, NgayDuyet = SYSUTCDATETIME(), NhanXet = N'Công việc đã hủy.'
             WHERE TrangThai = 0 AND MaPhanCong IN (SELECT MaPhanCong FROM dbo.PhanCong WHERE MaCongViec = @taskId);
             UPDATE dbo.PhanCong SET TrangThaiPhanCong = 6 WHERE MaCongViec = @taskId AND TrangThaiPhanCong IN (0, 1, 2, 3);`,
            { taskId, userId },
          );
          await closePendingDeclines(db, userId, 'Công việc đã hủy.', 'MaPhanCong IN (SELECT MaPhanCong FROM dbo.PhanCong WHERE MaCongViec = @taskId)', { taskId });
          await setTaskStatus(db, taskId, P.Cancelled);
          await notify(db, recipients, taskId, N.System, 1, `Đã hủy: ${t.TieuDe}`, `Lý do: ${note}`, false, userId);
          break;
        case 'complete': {
          const blocked = await completeTask(db, t, assignments);
          if (blocked) return conflict(blocked);
          await notify(db, recipients, taskId, N.System, 0, `Hoàn thành: ${t.TieuDe}`, 'Công việc đã được đóng là Hoàn thành.', false, userId);
          break;
        }
        default:
          return invalidField('action', 'Thao tác không hợp lệ.');
      }
      if (note) await logHistory(db, taskId, userId, 'GhiChu', note);
      return ok(taskId);
    });
  }

  // ---------- Giao việc ----------
  assign(userId: number, taskId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const rights = await loadRights(db, userId);
      if (!rights) return unauthorized();
      const t = await lockTask(db, taskId);
      if (!t) return notFound(NOT_FOUND_TASK);
      if (!P.canManage(rights, t)) return forbidden('Bạn không có quyền giao việc trên công việc này.');
      if (!P.isRunning(t)) return conflict(t.TrangThai === P.Draft ? 'Đây là bản nháp. Tạo chính thức trước khi giao việc.' : 'Chỉ giao việc khi công việc đang diễn ra (không tạm dừng, chưa xong, chưa hủy).');

      const scope = assignScope(rights, t);
      const errors: Record<string, string> = {};
      const kind = clean(input.kind).toLowerCase();
      if (kind !== 'person' && kind !== 'unit') errors.kind = 'Chọn giao cho cá nhân hoặc cả đơn vị.';
      const role = toInt(input.role);
      if (role != null && role !== 1 && role !== 2) errors.role = 'Vai trò chỉ là Chủ trì hoặc Phối hợp.';
      const note = clean(input.note);
      if (note.length > 2000) errors.note = 'Lời nhắn tối đa 2.000 ký tự.';

      let due = t.HanHoanThanh ?? new Date(Date.now() + 7 * DAY_MS);
      const dueText = toStr(input.due);
      if (dueText && dueText.trim()) {
        const parsed = parseVnDate(dueText, true);
        if (!parsed) errors.due = 'Hạn riêng không hợp lệ.';
        else if (parsed < nowUtc()) errors.due = 'Hạn riêng đã qua. Chọn từ hôm nay trở đi.';
        else if (t.HanHoanThanh && parsed > t.HanHoanThanh) errors.due = `Hạn riêng không được muộn hơn hạn chung ${localText(t.HanHoanThanh)}.`;
        else due = parsed;
      }

      const existing = await assignmentsOf(db, taskId);
      const personIds = [...new Set(toIntList(input.personIds))];
      const unitId = toInt(input.unitId);
      if (kind === 'person') {
        if (personIds.length === 0) errors.personIds = 'Chọn ít nhất một người nhận.';
        else if (personIds.length > 30) errors.personIds = 'Mỗi lần giao tối đa 30 người.';
        else {
          const valid = new Set((await db.query<{ MaNguoiDung: number }>(
            `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
             SELECT DISTINCT n.MaNguoiDung FROM dbo.NguoiDung AS n
             JOIN dbo.ThanhVienDonVi AS tv ON tv.MaNguoiDung = n.MaNguoiDung
             WHERE n.MaNguoiDung IN @personIds AND n.TrangThaiTaiKhoan = 1 AND tv.TrangThai = 1
               AND tv.MaDonVi IN @scope AND tv.NgayThamGia <= @HomNay AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay);`,
            { personIds, scope: scope.size ? [...scope] : [0] },
          )).map((x) => x.MaNguoiDung));
          if (personIds.some((id) => !valid.has(id))) errors.personIds = 'Có người không thuộc đơn vị trong phạm vi bạn được giao việc, hoặc tài khoản đang khóa.';
          const dup = existing.filter((a) => P.isActive(a) && a.TrangThaiPhanCong !== P.AsDone && a.MaNguoiNhan != null && personIds.includes(a.MaNguoiNhan));
          if (dup.length) errors.personIds = `${dup.map((a) => a.TenNguoiNhan).join(', ')} đang có phân công chưa xong trên công việc này.`;
        }
      } else if (kind === 'unit') {
        if (unitId == null) errors.unitId = 'Chọn đơn vị nhận việc.';
        else if (!scope.has(unitId)) errors.unitId = 'Đơn vị này không nằm trong phạm vi bạn được giao việc.';
        else if (existing.some((a) => P.isActive(a) && a.TrangThaiPhanCong !== P.AsDone && a.MaDonViNhan === unitId)) errors.unitId = 'Đơn vị này đang có phân công chưa xong trên công việc.';
        else if ((await unitManagers(db, unitId)).length === 0)
          errors.unitId = 'Đơn vị chưa có ai giữ chức vụ được giao việc để tiếp nhận. Giao cho cá nhân, hoặc cấu hình chức vụ trưởng đơn vị trước.';
      }
      if (Object.keys(errors).length) return invalid(errors);

      const giverUnit = scope.has(t.MaDonViQuanLy) ? t.MaDonViQuanLy : null;
      const targets: [number | null, number | null][] = kind === 'person' ? personIds.map((id) => [id, null]) : [[null, unitId]];
      let created = 0;
      for (const [personId, toUnit] of targets) {
        await db.exec(
          `INSERT dbo.PhanCong (MaCongViec, MaNguoiGiao, MaDonViGiao, MaNguoiNhan, MaDonViNhan, NoiDungGiao, TrangThaiPhanCong, HanHoanThanh, VaiTro)
           VALUES (@taskId, @userId, @giverUnit, @personId, @toUnit, @note, 0, @due, @role);`,
          { taskId, userId, giverUnit, personId, toUnit, note: note || null, due, role },
        );
        created++;
        const whoName = personId != null
          ? await db.scalar<string>('SELECT HoTen FROM dbo.NguoiDung WHERE MaNguoiDung = @pid;', { pid: personId })
          : await db.scalar<string>('SELECT TenDonVi FROM dbo.DonVi WHERE MaDonVi = @toUnit;', { toUnit });
        await logHistory(db, taskId, userId, 'GiaoViec', `Giao cho ${whoName}${roleText(role)}, hạn ${localText(due)}`);
        const recipients = personId != null ? [personId] : await unitManagers(db, toUnit!);
        await notify(db, recipients, taskId, N.Assign, 0,
          personId == null ? `Đơn vị được giao việc: ${t.TieuDe}` : `Việc mới: ${t.TieuDe}`,
          `${rights.userName} giao${personId == null ? ` cho ${whoName}` : ''}, hạn ${localText(due)}.${note ? ' Lời nhắn: ' + note : ''}`, true, userId);
      }
      await syncTask(db, taskId);
      return ok(created);
    });
  }

  // ---------- Tiếp nhận / từ chối / phân công lại ----------
  accept(userId: number, assignmentId: number): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.isAssignee(rights, a)) return forbidden('Chỉ người nhận việc được tiếp nhận.');
      if (a.TrangThaiPhanCong !== P.AsWaiting) return conflict('Phân công này đã được tiếp nhận hoặc đã đóng.');
      if (!P.isRunning(t)) return conflict('Công việc đang tạm dừng, đã xong hoặc đã hủy.');
      await db.exec('UPDATE dbo.PhanCong SET TrangThaiPhanCong = 1, NgayTiepNhan = SYSUTCDATETIME() WHERE MaPhanCong = @assignmentId;', { assignmentId });
      await logHistory(db, t.MaCongViec, userId, 'TiepNhan', `${rights.userName} tiếp nhận${a.MaDonViNhan != null ? ` cho ${a.TenDonViNhan}` : ''}`);
      await notify(db, [a.MaNguoiGiao], t.MaCongViec, N.Accept, 0, `Đã tiếp nhận: ${t.TieuDe}`, `${rights.userName} đã tiếp nhận việc.`, false, userId);
      await markHandled(db, userId, t.MaCongViec, N.Assign);
      await syncTask(db, t.MaCongViec);
      return ok(assignmentId);
    });
  }

  reject(userId: number, assignmentId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const reason = clean(input.reason);
      if (!reason) return invalidField('reason', 'Nhập lý do từ chối để người giao biết.');
      if (reason.length > 1000) return invalidField('reason', 'Lý do tối đa 1.000 ký tự.');
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.isAssignee(rights, a)) return forbidden('Chỉ người nhận việc được từ chối.');
      if (a.TrangThaiPhanCong !== P.AsWaiting) return conflict('Chỉ từ chối được khi chưa tiếp nhận.');
      await db.exec('UPDATE dbo.PhanCong SET TrangThaiPhanCong = 5 WHERE MaPhanCong = @assignmentId;', { assignmentId });
      await logHistory(db, t.MaCongViec, userId, 'TuChoi', `${rights.userName} từ chối nhận việc. Lý do: ${reason}`);
      await notify(db, [a.MaNguoiGiao], t.MaCongViec, N.Accept, 1, `Từ chối nhận việc: ${t.TieuDe}`, `${rights.userName}: ${reason}`, true, userId);
      await markHandled(db, userId, t.MaCongViec, N.Assign);
      await syncTask(db, t.MaCongViec);
      return ok(assignmentId);
    });
  }

  /** Trưởng đơn vị nhận việc tiếp nhận và giao lại cho thành viên đơn vị. */
  delegate(userId: number, assignmentId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (a.MaDonViNhan == null) return conflict('Chỉ phân công lại được việc giao cho cả đơn vị.');
      const unitId = a.MaDonViNhan;
      if (!P.isUnitManagerOf(rights, a)) return forbidden('Chỉ người có quyền giao việc ở đơn vị nhận được phân công lại.');
      if (!P.isOpen(a)) return conflict('Phân công của đơn vị đã nộp, đã xong hoặc đã đóng.');
      if (!P.isRunning(t)) return conflict('Công việc đang tạm dừng, đã xong hoặc đã hủy.');

      const raw = Array.isArray(input.members) ? (input.members as Record<string, unknown>[]) : [];
      const seen = new Set<number>();
      const members = raw.filter((m) => m && toInt(m.personId) != null).filter((m) => {
        const id = toInt(m.personId)!;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const errors: Record<string, string> = {};
      if (members.length === 0) errors.members = 'Chọn ít nhất một thành viên thực hiện.';
      const note = clean(input.note);
      if (note.length > 2000) errors.note = 'Lời nhắn tối đa 2.000 ký tự.';
      const validMembers = new Set((await db.query<{ MaNguoiDung: number }>(
        `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
         SELECT DISTINCT tv.MaNguoiDung FROM dbo.ThanhVienDonVi AS tv JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = tv.MaNguoiDung
         WHERE tv.MaDonVi = @unitId AND tv.TrangThai = 1 AND n.TrangThaiTaiKhoan = 1
           AND tv.NgayThamGia <= @HomNay AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay);`,
        { unitId },
      )).map((x) => x.MaNguoiDung));
      const existing = await assignmentsOf(db, t.MaCongViec);
      const plans: { personId: number; role: number | null; due: Date }[] = [];
      for (const m of members) {
        const pid = toInt(m.personId)!;
        if (!validMembers.has(pid)) { errors.members = 'Có người không còn là thành viên của đơn vị.'; break; }
        if (existing.some((x) => x.MaNguoiNhan === pid && P.isActive(x) && x.TrangThaiPhanCong !== P.AsDone)) { errors.members = 'Có thành viên đang có phân công chưa xong trên công việc này.'; break; }
        const role = toInt(m.role);
        if (role != null && role !== 1 && role !== 2) { errors.members = 'Vai trò chỉ là Chủ trì hoặc Phối hợp.'; break; }
        let due = a.HanHoanThanh;
        const dueText = toStr(m.due);
        if (dueText && dueText.trim()) {
          const parsed = parseVnDate(dueText, true);
          if (!parsed) { errors.members = 'Hạn riêng không hợp lệ.'; break; }
          if (parsed > a.HanHoanThanh) { errors.members = `Hạn riêng không được muộn hơn hạn của đơn vị ${localText(a.HanHoanThanh)}.`; break; }
          if (parsed < nowUtc()) { errors.members = 'Hạn riêng đã qua.'; break; }
          due = parsed;
        }
        plans.push({ personId: pid, role, due });
      }
      if (Object.keys(errors).length) return invalid(errors);

      if (a.TrangThaiPhanCong === P.AsWaiting)
        await db.exec('UPDATE dbo.PhanCong SET TrangThaiPhanCong = 2, NgayTiepNhan = SYSUTCDATETIME() WHERE MaPhanCong = @assignmentId;', { assignmentId });
      else if (a.TrangThaiPhanCong === P.AsAccepted)
        await db.exec('UPDATE dbo.PhanCong SET TrangThaiPhanCong = 2 WHERE MaPhanCong = @assignmentId;', { assignmentId });

      for (const plan of plans) {
        await db.exec(
          `INSERT dbo.PhanCong (MaCongViec, MaNguoiGiao, MaDonViGiao, MaNguoiNhan, MaDonViNhan, NoiDungGiao, TrangThaiPhanCong, HanHoanThanh, VaiTro)
           VALUES (@taskId, @userId, @unitId, @personId, NULL, @note, 0, @due, @role);`,
          { taskId: t.MaCongViec, userId, unitId, personId: plan.personId, note: note || null, due: plan.due, role: plan.role },
        );
        await notify(db, [plan.personId], t.MaCongViec, N.Assign, 0, `Việc mới: ${t.TieuDe}`,
          `${rights.userName} (${a.TenDonViNhan}) giao, hạn ${localText(plan.due)}.${note ? ' Lời nhắn: ' + note : ''}`, true, userId);
      }
      const names = (await db.query<{ HoTen: string }>('SELECT HoTen FROM dbo.NguoiDung WHERE MaNguoiDung IN @ids;', { ids: plans.map((x) => x.personId) })).map((x) => x.HoTen);
      await logHistory(db, t.MaCongViec, userId, 'PhanCongLai', `${a.TenDonViNhan} tiếp nhận và giao cho ${names.join(', ')}`);
      await notify(db, [a.MaNguoiGiao], t.MaCongViec, N.Accept, 0, `${a.TenDonViNhan} đã tiếp nhận: ${t.TieuDe}`, `Đã phân công cho ${plans.length} thành viên.`, false, userId);
      await markHandled(db, userId, t.MaCongViec, N.Assign);
      await syncTask(db, t.MaCongViec);
      return ok(plans.length);
    });
  }

  // ---------- Tiến độ / nộp kết quả / đánh giá ----------
  progress(userId: number, assignmentId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const errors: Record<string, string> = {};
      const pct = toNumber(input.percent);
      if (pct == null || pct < 0 || pct > 100) errors.percent = 'Tiến độ từ 0 đến 100%.';
      const note = clean(input.note);
      if (!note) errors.note = 'Ghi lại đã làm được gì trong lần cập nhật này.';
      else if (note.length > 2000) errors.note = 'Nội dung tối đa 2.000 ký tự.';
      if (Object.keys(errors).length) return invalid(errors);
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.isAssignee(rights, a)) return forbidden('Chỉ người nhận việc được cập nhật tiến độ.');
      if (a.TrangThaiPhanCong !== P.AsAccepted && a.TrangThaiPhanCong !== P.AsWorking)
        return conflict(a.TrangThaiPhanCong === P.AsWaiting ? 'Tiếp nhận việc trước khi cập nhật tiến độ.' : 'Phân công đã nộp, đã xong hoặc đã đóng.');
      if (!P.isRunning(t)) return conflict('Công việc đang tạm dừng, đã xong hoặc đã hủy.');
      const blocker = await dependencyBlocker(db, t.MaCongViec);
      if (blocker) return conflict(`Chưa bắt đầu được: cần hoàn thành “${blocker}” trước.`);
      const percent = Math.round(pct! * 100) / 100;
      await db.exec(
        `INSERT dbo.CapNhatTienDo (MaPhanCong, MaNguoiCapNhat, PhanTramTienDo, NoiDungThucHien) VALUES (@assignmentId, @userId, @percent, @note);
         UPDATE dbo.PhanCong SET TrangThaiPhanCong = 2 WHERE MaPhanCong = @assignmentId AND TrangThaiPhanCong = 1;`,
        { assignmentId, userId, percent, note },
      );
      await logHistory(db, t.MaCongViec, userId, 'CapNhatTienDo', `${rights.userName} cập nhật tiến độ: ${note}`, 'PhanTramTienDo', formatDecimal(Number(a.PhanTramBaoCao)), formatDecimal(percent));
      await syncTask(db, t.MaCongViec);
      return ok(assignmentId);
    });
  }

  /** Nộp kết quả: tệp đã được lưu tạm trước giao dịch; lỗi thì xóa tệp. */
  async submit(userId: number, assignmentId: number, content: unknown, link: unknown, files: UploadedFile[]): Promise<Result<number>> {
    const cleanup = () => files.forEach((f) => tryDelete(f.path));
    const text = clean(content), url = clean(link);
    const errors: Record<string, string> = {};
    if (!text) errors.content = 'Mô tả kết quả đã làm được.';
    else if (text.length > 8000) errors.content = 'Mô tả kết quả tối đa 8.000 ký tự.';
    if (url) {
      let okUrl = url.length <= 1000;
      try { const u = new URL(url); okUrl = okUrl && (u.protocol === 'http:' || u.protocol === 'https:'); } catch { okUrl = false; }
      if (!okUrl) errors.link = 'Liên kết phải bắt đầu bằng http:// hoặc https://.';
    }
    const fileError = validateFiles(files);
    if (fileError) errors.files = fileError;
    if (Object.keys(errors).length) { cleanup(); return invalid(errors); }
    try {
      const result = await this.db.tx(userId, async (db) => {
        const c = await loadAssignmentContext(db, userId, assignmentId);
        if (c.kind !== 'ok') return c as Result<never>;
        const { rights, task: t, assignment: a } = c.value;
        if (!P.isAssignee(rights, a)) return forbidden('Chỉ người nhận việc được nộp kết quả.');
        if (a.TrangThaiPhanCong !== P.AsAccepted && a.TrangThaiPhanCong !== P.AsWorking)
          return conflict(a.TrangThaiPhanCong === P.AsReview ? 'Đã nộp, đang chờ duyệt. Chỉ nộp lại khi được yêu cầu bổ sung.' : 'Phân công chưa tiếp nhận, đã xong hoặc đã đóng.');
        if (!P.isRunning(t)) return conflict('Công việc đang tạm dừng, đã xong hoặc đã hủy.');
        const blocker = await dependencyBlocker(db, t.MaCongViec);
        if (blocker) return conflict(`Chưa nộp được: cần hoàn thành “${blocker}” trước.`);
        const attempt = (await db.scalar<number>('SELECT ISNULL(MAX(LanNop), 0) + 1 FROM dbo.KetQuaCongViec WITH (UPDLOCK, HOLDLOCK) WHERE MaPhanCong = @assignmentId;', { assignmentId }))!;
        const body = url ? `${text}\n\nLiên kết: ${url}` : text;
        const resultId = (await db.scalar<number>(
          `INSERT dbo.KetQuaCongViec (MaPhanCong, MaNguoiNop, LanNop, NoiDungKetQua, TrangThaiNop) VALUES (@assignmentId, @userId, @attempt, @body, 0);
           SELECT CONVERT(INT, SCOPE_IDENTITY());`,
          { assignmentId, userId, attempt, body },
        ))!;
        for (const f of files) {
          await db.exec(
            `INSERT dbo.TepDinhKem (MaKetQua, MaNguoiTaiLen, TenTep, DuongDan, LoaiTep, KichThuoc)
             VALUES (@resultId, @userId, @name, @path, @type, @size);`,
            { resultId, userId, name: safeFileName(f.originalname), path: FILE_PREFIX + path.basename(f.path), type: cut(f.mimetype || '', 100), size: f.size },
          );
        }
        await db.exec(
          `INSERT dbo.CapNhatTienDo (MaPhanCong, MaNguoiCapNhat, PhanTramTienDo, NoiDungThucHien) VALUES (@assignmentId, @userId, 100, @note);
           UPDATE dbo.PhanCong SET TrangThaiPhanCong = 3 WHERE MaPhanCong = @assignmentId;`,
          { assignmentId, userId, note: `Nộp kết quả lần ${attempt}` },
        );
        await logHistory(db, t.MaCongViec, userId, 'NopKetQua', `${rights.userName} nộp kết quả lần ${attempt}${files.length ? ` (${files.length} tệp)` : ''}`);
        await notify(db, [a.MaNguoiGiao], t.MaCongViec, N.Result, 0, `Kết quả chờ duyệt: ${t.TieuDe}`, `${rights.userName} nộp kết quả lần ${attempt}.`, true, userId);
        await syncTask(db, t.MaCongViec);
        return ok(resultId);
      });
      if (result.kind !== 'ok') cleanup();
      return result;
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  evaluate(userId: number, resultId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const comment = clean(input.comment);
      const decision = toInt(input.decision);
      const errors: Record<string, string> = {};
      if (decision !== 1 && decision !== 2 && decision !== 3) errors.decision = 'Chọn Đạt, Cần bổ sung hoặc Không đạt.';
      else if (decision !== 1 && !comment) errors.comment = 'Nhập nhận xét để người thực hiện biết cần sửa gì.';
      if (comment.length > 4000) errors.comment = 'Nhận xét tối đa 4.000 ký tự.';
      if (Object.keys(errors).length) return invalid(errors);
      const row = await db.one<{ MaPhanCong: number; LanNop: number; TrangThaiNop: number; MaNguoiNop: number }>(
        'SELECT MaPhanCong, LanNop, TrangThaiNop, MaNguoiNop FROM dbo.KetQuaCongViec WITH (UPDLOCK, HOLDLOCK) WHERE MaKetQua = @resultId;',
        { resultId },
      );
      if (!row) return notFound('Không tìm thấy kết quả.');
      const c = await loadAssignmentContext(db, userId, row.MaPhanCong);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.canEvaluate(rights, t, a)) return forbidden('Bạn không có quyền đánh giá kết quả này.');
      const latest = await db.scalar<number>('SELECT MAX(LanNop) FROM dbo.KetQuaCongViec WHERE MaPhanCong = @id;', { id: row.MaPhanCong });
      if (row.LanNop !== latest || row.TrangThaiNop !== 0 || a.TrangThaiPhanCong !== P.AsReview) return conflict('Chỉ đánh giá được lần nộp mới nhất đang chờ duyệt.');
      await db.exec(
        `INSERT dbo.DanhGia (MaKetQua, MaNguoiDanhGia, QuyetDinh, NhanXet) VALUES (@resultId, @userId, @decision, @comment);
         UPDATE dbo.KetQuaCongViec SET TrangThaiNop = @decision WHERE MaKetQua = @resultId;`,
        { resultId, userId, decision, comment: comment || null },
      );
      if (decision === 1) await db.exec('UPDATE dbo.PhanCong SET TrangThaiPhanCong = 4, NgayHoanThanh = SYSUTCDATETIME() WHERE MaPhanCong = @id;', { id: row.MaPhanCong });
      else await db.exec('UPDATE dbo.PhanCong SET TrangThaiPhanCong = 2 WHERE MaPhanCong = @id;', { id: row.MaPhanCong });
      const label = decision === 1 ? 'Đạt' : decision === 2 ? 'Cần bổ sung' : 'Không đạt';
      await logHistory(db, t.MaCongViec, userId, 'DuyetKetQua', `${rights.userName} đánh giá lần nộp ${row.LanNop} của ${a.TenNguoiNhan ?? a.TenDonViNhan}: ${label}`, 'TrangThaiNop', '0', String(decision));
      const target = a.MaNguoiNhan != null ? [a.MaNguoiNhan, row.MaNguoiNop] : [row.MaNguoiNop];
      await notify(db, target, t.MaCongViec, N.Result, decision === 1 ? 0 : 1, `Kết quả ${label}: ${t.TieuDe}`,
        comment ? `${rights.userName}: ${comment}` : `${rights.userName} đã duyệt kết quả.`, decision !== 1, userId);
      await markHandled(db, userId, t.MaCongViec, N.Result);
      await syncTask(db, t.MaCongViec);
      if (decision === 1) {
        // Duyệt Đạt phân công cuối cùng: tự đóng Hoàn thành (nếu còn phân công/công việc con dở thì giữ nguyên).
        const fresh = await lockTask(db, t.MaCongViec);
        const all = await assignmentsOf(db, t.MaCongViec);
        if (fresh && !(await completeTask(db, fresh, all))) {
          await logHistory(db, t.MaCongViec, userId, 'GhiChu', 'Tự động đóng Hoàn thành: mọi phân công đã được duyệt Đạt.');
          const recipients = all.filter(P.isActive).filter((x) => x.MaNguoiNhan != null).map((x) => x.MaNguoiNhan!);
          await notify(db, recipients, t.MaCongViec, N.System, 0, `Hoàn thành: ${t.TieuDe}`, 'Mọi kết quả đã được duyệt Đạt; công việc đã hoàn thành.', false, userId);
        }
      }
      return ok(resultId);
    });
  }

  // ---------- Gia hạn ----------
  requestExtension(userId: number, assignmentId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.isAssignee(rights, a)) return forbidden('Chỉ người nhận việc được xin gia hạn.');
      if (!P.isOpen(a) || !P.isRunning(t)) return conflict('Chỉ xin gia hạn khi việc còn đang làm.');
      const reason = clean(input.reason);
      const errors: Record<string, string> = {};
      const proposed = parseVnDate(input.proposedDue, true);
      if (!proposed) errors.proposedDue = 'Chọn hạn đề xuất.';
      else if (proposed <= a.HanHoanThanh) errors.proposedDue = `Hạn đề xuất phải sau hạn hiện tại ${localText(a.HanHoanThanh)}.`;
      else if (proposed.getTime() > a.HanHoanThanh.getTime() + 180 * DAY_MS) errors.proposedDue = 'Mỗi lần gia hạn tối đa 180 ngày.';
      if (!reason) errors.reason = 'Nhập lý do xin gia hạn.';
      else if (reason.length > 1000) errors.reason = 'Lý do tối đa 1.000 ký tự.';
      if (Object.keys(errors).length) return invalid(errors);
      const counts = (await db.one<{ Pending: number; Approved: number }>(
        `SELECT ISNULL(SUM(CASE WHEN TrangThai = 0 THEN 1 ELSE 0 END), 0) AS Pending,
                ISNULL(SUM(CASE WHEN TrangThai IN (1, 2) THEN 1 ELSE 0 END), 0) AS Approved
         FROM dbo.YeuCauGiaHan WITH (UPDLOCK, HOLDLOCK) WHERE MaPhanCong = @assignmentId;`,
        { assignmentId },
      ))!;
      if (counts.Pending > 0) return conflict('Đã có một yêu cầu gia hạn đang chờ duyệt.');
      if (counts.Approved >= P.MAX_APPROVED_EXTENSIONS)
        return conflict(`Phân công này đã được gia hạn ${P.MAX_APPROVED_EXTENSIONS} lần, không xin thêm được. Trao đổi trực tiếp với người giao.`);
      const id = (await db.scalar<number>(
        `INSERT dbo.YeuCauGiaHan (MaPhanCong, MaNguoiYeuCau, HanCu, HanDeXuat, LyDo) VALUES (@assignmentId, @userId, @old, @proposed, @reason);
         SELECT CONVERT(INT, SCOPE_IDENTITY());`,
        { assignmentId, userId, old: a.HanHoanThanh, proposed, reason },
      ))!;
      await logHistory(db, t.MaCongViec, userId, 'XinGiaHan', `${rights.userName} xin gia hạn từ ${localText(a.HanHoanThanh)} đến ${localText(proposed!)}. Lý do: ${reason}`);
      await notify(db, [a.MaNguoiGiao], t.MaCongViec, N.Extension, 1, `Xin gia hạn: ${t.TieuDe}`, `${rights.userName} xin gia hạn đến ${localText(proposed!)}. Lý do: ${reason}`, true, userId);
      return ok(id);
    });
  }

  decideExtension(userId: number, extensionId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const ext = await db.one<ExtensionRow>(
        `SELECT g.MaYeuCau, g.MaPhanCong, g.MaNguoiYeuCau, n.HoTen AS TenNguoiYeuCau, g.HanCu, g.HanDeXuat, g.LyDo, g.TrangThai,
                g.MaNguoiDuyet, NULL AS TenNguoiDuyet, g.HanDuocDuyet, g.NhanXet, g.NgayTao, g.NgayDuyet
         FROM dbo.YeuCauGiaHan AS g WITH (UPDLOCK, HOLDLOCK) JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = g.MaNguoiYeuCau
         WHERE g.MaYeuCau = @extensionId;`,
        { extensionId },
      );
      if (!ext) return notFound('Không tìm thấy yêu cầu gia hạn.');
      const c = await loadAssignmentContext(db, userId, ext.MaPhanCong);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.canDecideExtension(rights, t, a, ext.MaNguoiYeuCau)) return forbidden('Bạn không có quyền duyệt yêu cầu gia hạn này.');
      if (ext.TrangThai !== 0) return conflict('Yêu cầu này đã được xử lý.');
      const decision = clean(input.decision).toLowerCase();
      const comment = clean(input.comment);
      const errors: Record<string, string> = {};
      let approved: Date | null = null;
      let newStatus = 0;
      switch (decision) {
        case 'approve': approved = ext.HanDeXuat; newStatus = 1; break;
        case 'approve-other': {
          newStatus = 2;
          const other = parseVnDate(input.approvedDue, true);
          if (!other) errors.approvedDue = 'Chọn hạn mới được duyệt.';
          else if (other <= ext.HanCu) errors.approvedDue = `Hạn mới phải sau hạn cũ ${localText(ext.HanCu)}.`;
          else approved = other;
          if (!comment) errors.comment = 'Nhập nhận xét khi duyệt hạn khác với đề xuất.';
          break;
        }
        case 'reject':
          newStatus = 3;
          if (!comment) errors.comment = 'Nhập lý do từ chối.';
          break;
        default: errors.decision = 'Chọn Đồng ý, Đồng ý với hạn khác hoặc Từ chối.';
      }
      if (comment.length > 1000) errors.comment = 'Nhận xét tối đa 1.000 ký tự.';
      if (Object.keys(errors).length) return invalid(errors);
      await db.exec(
        `UPDATE dbo.YeuCauGiaHan SET TrangThai = @newStatus, MaNguoiDuyet = @userId, HanDuocDuyet = @approved, NhanXet = @comment, NgayDuyet = SYSUTCDATETIME()
         WHERE MaYeuCau = @extensionId;`,
        { newStatus, userId, approved, comment: comment || null, extensionId },
      );
      if (approved) {
        await db.exec('UPDATE dbo.PhanCong SET HanHoanThanh = @newDue WHERE MaPhanCong = @id;', { newDue: approved, id: ext.MaPhanCong });
        if (t.HanHoanThanh && approved > t.HanHoanThanh)
          await db.exec('UPDATE dbo.CongViec SET HanHoanThanh = @newDue WHERE MaCongViec = @taskId;', { newDue: approved, taskId: t.MaCongViec });
      }
      const label = newStatus === 1 ? 'Đồng ý' : newStatus === 2 ? 'Đồng ý với hạn khác' : 'Từ chối';
      await logHistory(db, t.MaCongViec, userId, 'DuyetGiaHan',
        `${rights.userName} ${label.toLowerCase()} gia hạn cho ${ext.TenNguoiYeuCau}${approved ? `: hạn mới ${localText(approved)}` : ''}`,
        'HanHoanThanh', localText(ext.HanCu), approved ? localText(approved) : null);
      await notify(db, [ext.MaNguoiYeuCau], t.MaCongViec, N.Extension, newStatus === 3 ? 1 : 0, `Gia hạn ${label.toLowerCase()}: ${t.TieuDe}`,
        approved ? `Hạn mới: ${localText(approved)}.${comment ? ' ' + comment : ''}` : comment, false, userId);
      await markHandled(db, userId, t.MaCongViec, N.Extension);
      return ok(extensionId);
    });
  }

  // ---------- Xin từ chối (đã tiếp nhận) ----------
  /** Người nhận đã tiếp nhận/đang làm xin thôi nhận việc; người giao duyệt. Chưa tiếp nhận thì dùng reject (từ chối ngay). */
  requestDecline(userId: number, assignmentId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const reason = clean(input.reason);
      if (!reason) return invalidField('reason', 'Nhập lý do xin từ chối để người giao cân nhắc.');
      if (reason.length > 1000) return invalidField('reason', 'Lý do tối đa 1.000 ký tự.');
      if (!(await declineTableReady(db))) return conflict('Chưa bật tính năng xin từ chối: chạy sql/04_XinTuChoi.sql.');
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.isAssignee(rights, a)) return forbidden('Chỉ người nhận việc được xin từ chối.');
      if (a.TrangThaiPhanCong === P.AsWaiting) return conflict('Việc chưa tiếp nhận: dùng nút “Từ chối” để từ chối ngay.');
      if (a.TrangThaiPhanCong !== P.AsAccepted && a.TrangThaiPhanCong !== P.AsWorking) return conflict('Chỉ xin từ chối khi việc đang làm (chưa nộp kết quả).');
      if (!P.isRunning(t)) return conflict('Công việc đang tạm dừng, đã xong hoặc đã hủy.');
      const pending = await db.scalar<number>('SELECT COUNT(*) FROM dbo.YeuCauTuChoi WITH (UPDLOCK, HOLDLOCK) WHERE MaPhanCong = @assignmentId AND TrangThai = 0;', { assignmentId });
      if (pending) return conflict('Đã có một yêu cầu xin từ chối đang chờ duyệt.');
      const id = (await db.scalar<number>(
        `INSERT dbo.YeuCauTuChoi (MaPhanCong, MaNguoiYeuCau, LyDo) VALUES (@assignmentId, @userId, @reason);
         SELECT CONVERT(INT, SCOPE_IDENTITY());`,
        { assignmentId, userId, reason },
      ))!;
      await logHistory(db, t.MaCongViec, userId, 'XinTuChoi', `${rights.userName} xin từ chối việc đã nhận. Lý do: ${reason}`);
      await notify(db, [a.MaNguoiGiao], t.MaCongViec, N.Accept, 1, `Xin từ chối việc: ${t.TieuDe}`, `${rights.userName}: ${reason}`, true, userId);
      return ok(id);
    });
  }

  decideDecline(userId: number, requestId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      if (!(await declineTableReady(db))) return notFound('Không tìm thấy yêu cầu xin từ chối.');
      const req = await db.one<{ MaPhanCong: number; MaNguoiYeuCau: number; TenNguoiYeuCau: string; TrangThai: number }>(
        `SELECT y.MaPhanCong, y.MaNguoiYeuCau, n.HoTen AS TenNguoiYeuCau, y.TrangThai
         FROM dbo.YeuCauTuChoi AS y WITH (UPDLOCK, HOLDLOCK) JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = y.MaNguoiYeuCau
         WHERE y.MaYeuCau = @requestId;`,
        { requestId },
      );
      if (!req) return notFound('Không tìm thấy yêu cầu xin từ chối.');
      const c = await loadAssignmentContext(db, userId, req.MaPhanCong);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (!P.canDecideDecline(rights, t, a, req.MaNguoiYeuCau)) return forbidden('Bạn không có quyền duyệt yêu cầu này.');
      if (req.TrangThai !== 0) return conflict('Yêu cầu này đã được xử lý.');
      const decision = clean(input.decision).toLowerCase();
      const comment = clean(input.comment);
      if (decision !== 'approve' && decision !== 'reject') return invalidField('decision', 'Chọn Đồng ý hoặc Không đồng ý.');
      if (decision === 'reject' && !comment) return invalidField('comment', 'Nhập lý do không đồng ý để người nhận biết.');
      if (comment.length > 1000) return invalidField('comment', 'Nhận xét tối đa 1.000 ký tự.');
      const approve = decision === 'approve';
      if (approve && a.TrangThaiPhanCong !== P.AsAccepted && a.TrangThaiPhanCong !== P.AsWorking)
        return conflict('Người nhận đã nộp kết quả hoặc phân công đã đóng; không chuyển sang từ chối được nữa.');
      await db.exec(
        `UPDATE dbo.YeuCauTuChoi SET TrangThai = @status, MaNguoiDuyet = @userId, NhanXet = @comment, NgayDuyet = SYSUTCDATETIME()
         WHERE MaYeuCau = @requestId;`,
        { status: approve ? 1 : 2, userId, comment: comment || null, requestId },
      );
      if (approve) {
        await db.exec(
          `UPDATE dbo.YeuCauGiaHan SET TrangThai = 3, MaNguoiDuyet = @userId, NgayDuyet = SYSUTCDATETIME(), NhanXet = N'Người nhận đã được đồng ý từ chối việc.'
           WHERE MaPhanCong = @id AND TrangThai = 0;
           UPDATE dbo.PhanCong SET TrangThaiPhanCong = 5 WHERE MaPhanCong = @id;`,
          { id: req.MaPhanCong, userId },
        );
      }
      const label = approve ? 'đồng ý' : 'không đồng ý';
      await logHistory(db, t.MaCongViec, userId, 'DuyetTuChoi', `${rights.userName} ${label} cho ${req.TenNguoiYeuCau} từ chối việc${comment ? '. ' + comment : ''}`);
      await notify(db, [req.MaNguoiYeuCau], t.MaCongViec, N.Accept, approve ? 0 : 1,
        approve ? `Đã đồng ý cho thôi nhận việc: ${t.TieuDe}` : `Không đồng ý từ chối: ${t.TieuDe}`,
        approve ? (comment || 'Bạn không còn phụ trách phân công này.') : `${comment} Bạn tiếp tục thực hiện công việc.`, false, userId);
      await markHandled(db, userId, t.MaCongViec, N.Accept);
      if (approve) await syncTask(db, t.MaCongViec);
      return ok(requestId);
    });
  }

  // ---------- Hủy phân công / nhắc việc ----------
  cancelAssignment(userId: number, assignmentId: number, input: Record<string, unknown>): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const reason = clean(input.reason);
      if (!reason) return invalidField('reason', 'Nhập lý do hủy phân công.');
      if (reason.length > 1000) return invalidField('reason', 'Lý do tối đa 1.000 ký tự.');
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (a.MaNguoiGiao !== userId && !P.canManage(rights, t)) return forbidden('Chỉ người giao hoặc người quản lý công việc được hủy phân công.');
      if ([P.AsDone, P.AsRejected, P.AsCancelled].includes(a.TrangThaiPhanCong)) return conflict('Phân công đã đóng.');
      await db.exec(
        `UPDATE dbo.YeuCauGiaHan SET TrangThai = 3, MaNguoiDuyet = @userId, NgayDuyet = SYSUTCDATETIME(), NhanXet = N'Phân công đã hủy.'
         WHERE MaPhanCong = @assignmentId AND TrangThai = 0;
         UPDATE dbo.PhanCong SET TrangThaiPhanCong = 6 WHERE MaPhanCong = @assignmentId;`,
        { assignmentId, userId },
      );
      await closePendingDeclines(db, userId, 'Phân công đã hủy.', 'MaPhanCong = @assignmentId', { assignmentId });
      await logHistory(db, t.MaCongViec, userId, 'HuyPhanCong', `Hủy phân công của ${a.TenNguoiNhan ?? a.TenDonViNhan}. Lý do: ${reason}`);
      const recipients = a.MaNguoiNhan != null ? [a.MaNguoiNhan] : await unitManagers(db, a.MaDonViNhan!);
      await notify(db, recipients, t.MaCongViec, N.System, 1, `Đã hủy phân công: ${t.TieuDe}`, `Lý do: ${reason}`, false, userId);
      await syncTask(db, t.MaCongViec);
      return ok(assignmentId);
    });
  }

  remind(userId: number, assignmentId: number): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const c = await loadAssignmentContext(db, userId, assignmentId);
      if (c.kind !== 'ok') return c as Result<never>;
      const { rights, task: t, assignment: a } = c.value;
      if (a.MaNguoiGiao !== userId && !P.canManage(rights, t)) return forbidden('Chỉ người giao hoặc người quản lý công việc được nhắc việc.');
      if (!P.isOpen(a) || !P.isRunning(t)) return conflict('Phân công không còn đang làm.');
      const recipients = a.MaNguoiNhan != null ? [a.MaNguoiNhan] : await unitManagers(db, a.MaDonViNhan!);
      const recent = await db.scalar<number>(
        `SELECT COUNT(*) FROM dbo.ThongBao
         WHERE MaCongViec = @taskId AND LoaiThongBao = N'ChamTienDo' AND MaNguoiNhan IN @recipients
           AND NgayTao > DATEADD(HOUR, -12, SYSUTCDATETIME());`,
        { taskId: t.MaCongViec, recipients: recipients.length ? recipients : [0] },
      );
      if ((recent ?? 0) > 0) return conflict('Đã nhắc trong 12 giờ qua. Vui lòng chờ thêm.');
      const what = a.TrangThaiPhanCong === P.AsWaiting ? 'tiếp nhận' : 'cập nhật tiến độ';
      await notify(db, recipients, t.MaCongViec, N.Slow, 1, `Nhắc việc: ${t.TieuDe}`, `${rights.userName} nhắc bạn ${what}. Hạn ${localText(a.HanHoanThanh)}.`, true, userId);
      return ok(recipients.length);
    });
  }

  // ---------- Bình luận ----------
  /** Bình luận (JSON hoặc multipart kèm tệp ≤ 10 × 20 MB). Có tệp thì được để trống nội dung. */
  async comment(userId: number, taskId: number, input: Record<string, unknown>, files: UploadedFile[] = []): Promise<Result<number>> {
    const cleanup = () => files.forEach((f) => tryDelete(f.path));
    const content = clean(input.content);
    if (!content && !files.length) { cleanup(); return invalidField('content', 'Nhập nội dung hoặc đính kèm tệp.'); }
    if (content.length > 4000) { cleanup(); return invalidField('content', 'Bình luận tối đa 4.000 ký tự.'); }
    const fileError = validateFiles(files);
    if (fileError) { cleanup(); return invalidField('files', fileError); }
    try {
      const result = await this.commentTx(userId, taskId, input, content || '(Gửi tệp đính kèm)', files);
      if (result.kind !== 'ok') cleanup();
      return result;
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  private commentTx(userId: number, taskId: number, input: Record<string, unknown>, content: string, files: UploadedFile[]): Promise<Result<number>> {
    return this.db.tx(userId, async (db) => {
      const rights = await loadRights(db, userId);
      if (!rights) return unauthorized();
      const t = await lockTask(db, taskId);
      if (!t) return notFound(NOT_FOUND_TASK);
      const assignments = await assignmentsOf(db, taskId);
      if (!P.related(rights, t, assignments)) return forbidden('Chỉ người liên quan đến công việc được bình luận.');
      if (t.TrangThai === P.Draft) return conflict('Bản nháp chưa có thảo luận.');
      const parentId = toInt(input.parentId);
      // Người được trả lời: tác giả bình luận gốc, hoặc người được nhắc (replyToId) khi trả lời trong luồng.
      let replyTo: number | null = null;
      if (parentId != null) {
        const parentAuthor = await db.scalar<number>('SELECT MaNguoiViet FROM dbo.BinhLuan WHERE MaBinhLuan = @parentId AND MaCongViec = @taskId;', { parentId, taskId });
        if (parentAuthor == null) return invalidField('parentId', 'Bình luận được trả lời không còn tồn tại.');
        replyTo = toInt(input.replyToId) ?? parentAuthor;
      }
      const id = (await db.scalar<number>(
        `INSERT dbo.BinhLuan (MaCongViec, MaNguoiViet, MaBinhLuanCha, NoiDung) VALUES (@taskId, @userId, @parentId, @content);
         SELECT CONVERT(INT, SCOPE_IDENTITY());`,
        { taskId, userId, parentId, content },
      ))!;
      for (const f of files) {
        await db.exec(
          `INSERT dbo.TepDinhKem (MaBinhLuan, MaNguoiTaiLen, TenTep, DuongDan, LoaiTep, KichThuoc)
           VALUES (@id, @userId, @name, @path, @type, @size);`,
          { id, userId, name: safeFileName(f.originalname), path: FILE_PREFIX + path.basename(f.path), type: cut(f.mimetype || '', 100), size: f.size },
        );
      }
      await logHistory(db, taskId, userId, 'BinhLuan', `${rights.userName} ${parentId != null ? 'trả lời bình luận' : 'bình luận'}${files.length ? ` (${files.length} tệp)` : ''}`);
      const participants = [t.MaNguoiTao];
      for (const a of assignments.filter(P.isActive)) {
        participants.push(a.MaNguoiGiao);
        if (a.MaNguoiNhan != null) participants.push(a.MaNguoiNhan);
      }
      const preview = `${rights.userName}: ${cut(content, 300)}${files.length ? ` · ${files.length} tệp đính kèm` : ''}`;
      if (replyTo != null && replyTo !== userId) {
        await notify(db, [replyTo], taskId, N.Comment, 0, `${rights.userName} đã trả lời bạn: ${t.TieuDe}`, preview, false, userId);
      }
      await notify(db, participants.filter((p) => p !== replyTo), taskId, N.Comment, 0, `Bình luận mới: ${t.TieuDe}`, preview, false, userId);
      return ok(id);
    });
  }
}

