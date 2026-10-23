import type {
  AssignOptionsDto, AssignmentDto, CommentDto, DeclineDto, DueAlertDto, DueAlertItemDto, ExtensionDto, FileDto, HistoryDto, TaskDetailDto,
  TaskLinkDto, TaskListDto, TaskSummaryDto, TaskPermissionsDto,
} from '@khoa/shared';
import type { SqlRunner } from '../db/db.service';
import { initials, normalize, unitInitials } from '../common/text';
import { iso, nowUtc } from '../common/vn-time';
import { unitTypeLabel } from '../common/mapping';
import type { TaskRights } from './task-access';
import * as P from './task-policy';
import { FILE_PREFIX } from './task-support';
import type { AssignmentRow, DeclineRow, ExtensionRow, FileRow, TaskRow } from './task-policy';

/**
 * Đọc công việc theo phạm vi người xem. Một người thấy công việc khi là người tạo/giao/nhận (cá nhân hoặc quản lý đơn vị nhận),
 * hoặc đơn vị quản lý nằm trong phạm vi quyền (tạo/giao/duyệt/xem báo cáo), hoặc là quản trị hệ thống (chỉ đọc).
 * Bản nháp chỉ người tạo thấy.
 */
const VISIBLE = `(cv.TrangThai <> 0 OR cv.MaNguoiTao = @me)
  AND (@isAdmin = 1 OR cv.MaNguoiTao = @me OR cv.MaDonViQuanLy IN @viewUnits
       OR EXISTS (SELECT 1 FROM dbo.PhanCong AS vp
                  WHERE vp.MaCongViec = cv.MaCongViec
                    AND (vp.MaNguoiNhan = @me OR vp.MaNguoiGiao = @me OR vp.MaDonViNhan IN @assignUnits)))`;

export interface Snapshot {
  tasks: TaskRow[];
  assignments: AssignmentRow[];
  /** Phân công có kết quả mới nhất đang chờ duyệt. */
  pendingResultAssignments: Set<number>;
  /** Phân công có yêu cầu gia hạn đang chờ → người yêu cầu. */
  pendingExtensionRequester: Map<number, number>;
  /** Phân công có yêu cầu xin từ chối đang chờ → người yêu cầu. */
  pendingDeclineRequester: Map<number, number>;
}

const person = (id: number, name: string) => ({ id, name, initials: initials(name) });

/** Toàn bộ công việc người này được xem, kèm phân công (đủ cho danh sách, lịch, Kanban, cảnh báo). */
export async function loadVisible(db: SqlRunner, r: TaskRights, onlyTaskId: number | null = null): Promise<Snapshot> {
  const args = { me: r.userId, isAdmin: r.isAdmin, viewUnits: [...r.viewUnits], assignUnits: [...r.assignUnits], taskId: onlyTaskId };
  const filter = `${VISIBLE} AND (@taskId IS NULL OR cv.MaCongViec = @taskId)`;
  const tasks = await db.query<TaskRow>(`SELECT ${P.TASK_COLUMNS} ${P.TASK_FROM} WHERE ${filter};`, args);
  if (tasks.length === 0) return { tasks: [], assignments: [], pendingResultAssignments: new Set(), pendingExtensionRequester: new Map(), pendingDeclineRequester: new Map() };
  const inVisible = `(SELECT cv.MaCongViec FROM dbo.CongViec AS cv WHERE ${filter})`;
  const assignments = await db.query<AssignmentRow>(
    `SELECT ${P.ASSIGNMENT_COLUMNS} ${P.assignmentFrom()} WHERE p.MaCongViec IN ${inVisible} ORDER BY p.NgayGiao, p.MaPhanCong;`,
    args,
  );
  const pendingResults = await db.query<{ MaPhanCong: number }>(
    `SELECT p.MaPhanCong
     FROM dbo.PhanCong AS p
     JOIN dbo.KetQuaCongViec AS k ON k.MaPhanCong = p.MaPhanCong
     WHERE k.TrangThaiNop = 0
       AND k.LanNop = (SELECT MAX(k2.LanNop) FROM dbo.KetQuaCongViec AS k2 WHERE k2.MaPhanCong = p.MaPhanCong)
       AND p.MaCongViec IN ${inVisible};`,
    args,
  );
  const pendingExt = await db.query<{ MaPhanCong: number; MaNguoiYeuCau: number }>(
    `SELECT p.MaPhanCong, g.MaNguoiYeuCau
     FROM dbo.YeuCauGiaHan AS g
     JOIN dbo.PhanCong AS p ON p.MaPhanCong = g.MaPhanCong
     WHERE g.TrangThai = 0 AND p.MaCongViec IN ${inVisible};`,
    args,
  );
  const ext = new Map<number, number>();
  for (const x of pendingExt) if (!ext.has(x.MaPhanCong)) ext.set(x.MaPhanCong, x.MaNguoiYeuCau);
  const pendingDecl = await db.query<{ MaPhanCong: number; MaNguoiYeuCau: number }>(
    `IF ${P.HAS_DECLINE_TABLE}
       SELECT p.MaPhanCong, y.MaNguoiYeuCau
       FROM dbo.YeuCauTuChoi AS y
       JOIN dbo.PhanCong AS p ON p.MaPhanCong = y.MaPhanCong
       WHERE y.TrangThai = 0 AND p.MaCongViec IN ${inVisible};
     ELSE SELECT CAST(NULL AS INT) AS MaPhanCong, CAST(NULL AS INT) AS MaNguoiYeuCau WHERE 1 = 0;`,
    args,
  );
  const decl = new Map(pendingDecl.map((x) => [x.MaPhanCong, x.MaNguoiYeuCau] as [number, number]));
  return { tasks, assignments, pendingResultAssignments: new Set(pendingResults.map((x) => x.MaPhanCong)), pendingExtensionRequester: ext, pendingDeclineRequester: decl };
}

export function toSummary(r: TaskRights, s: Snapshot, t: TaskRow, now: Date): TaskSummaryDto {
  const mine = s.assignments.filter((a) => a.MaCongViec === t.MaCongViec);
  const active = mine.filter(P.isActive);
  const assignees = active.map((a) =>
    a.MaNguoiNhan != null
      ? { kind: 'person' as const, id: a.MaNguoiNhan, name: a.TenNguoiNhan ?? '', initials: initials(a.TenNguoiNhan ?? '?'), status: a.TrangThaiPhanCong }
      : { kind: 'unit' as const, id: a.MaDonViNhan ?? 0, name: a.TenDonViNhan ?? '', initials: unitInitials(a.TenDonViNhan), status: a.TrangThaiPhanCong },
  );
  // Phân công của chính người xem (ưu tiên việc còn mở) để danh sách có nút thao tác nhanh.
  const rank = (a: AssignmentRow) => (P.isOpen(a) ? 0 : a.TrangThaiPhanCong === P.AsReview ? 1 : 2);
  const myAssignment = active
    .filter((a) => P.isAssignee(r, a))
    .sort((a, b) => rank(a) - rank(b) || a.HanHoanThanh.getTime() - b.HanHoanThanh.getTime())[0];
  let pending = 0;
  for (const a of mine) {
    if (s.pendingResultAssignments.has(a.MaPhanCong) && P.canEvaluate(r, t, a)) pending++;
    const requester = s.pendingExtensionRequester.get(a.MaPhanCong);
    if (requester !== undefined && P.canDecideExtension(r, t, a, requester)) pending++;
    const decliner = s.pendingDeclineRequester.get(a.MaPhanCong);
    if (decliner !== undefined && P.canDecideDecline(r, t, a, decliner)) pending++;
  }
  return {
    id: t.MaCongViec, title: t.TieuDe, status: t.TrangThai, priority: t.MucDoUuTien, progress: Number(t.PhanTramTienDo),
    start: iso(t.NgayBatDau), due: iso(t.HanHoanThanh), createdAt: iso(t.NgayTao)!, completedAt: iso(t.NgayHoanThanh),
    unitId: t.MaDonViQuanLy, unitName: t.TenDonVi, categoryId: t.MaTheLoai, categoryName: t.TenTheLoai ?? '',
    creatorId: t.MaNguoiTao, creatorName: t.TenNguoiTao, parentId: t.MaCongViecCha,
    overdue: P.isOverdue(t.HanHoanThanh, t.TrangThai, now), dueSoon: P.isDueSoon(t.HanHoanThanh, t.TrangThai, now),
    assignees,
    assignedToMe: active.some((a) => P.isAssignee(r, a)),
    createdOrAssignedByMe: t.MaNguoiTao === r.userId || mine.some((a) => a.MaNguoiGiao === r.userId),
    pendingReviews: pending,
    myAssignmentId: myAssignment?.MaPhanCong ?? null,
    myAssignmentStatus: myAssignment?.TrangThaiPhanCong ?? null,
    myProgress: myAssignment ? Number(myAssignment.PhanTramBaoCao) : null,
    myDue: iso(myAssignment?.HanHoanThanh),
    myRole: myAssignment?.VaiTro ?? null,
  };
}

export interface ListQuery {
  scope: string | null; status: number[]; categoryId: number | null; priority: number | null; unitId: number | null;
  overdue: boolean; dueSoon: boolean; search: string | null;
}

/** Danh sách theo nhóm: assigned (tôi được giao), created (tôi tạo/giao), all (trong phạm vi), review (chờ tôi duyệt). */
export async function list(db: SqlRunner, r: TaskRights, q: ListQuery): Promise<TaskListDto> {
  const s = await loadVisible(db, r);
  const now = nowUtc();
  const all = s.tasks.map((t) => toSummary(r, s, t, now));
  const counts = {
    assigned: all.filter((x) => x.assignedToMe && x.status !== P.Draft).length,
    created: all.filter((x) => x.createdOrAssignedByMe).length,
    all: all.length,
    review: all.filter((x) => x.pendingReviews > 0).length,
    overdue: all.filter((x) => x.overdue).length,
  };
  let items: TaskSummaryDto[];
  switch (q.scope ?? 'assigned') {
    case 'created': items = all.filter((x) => x.createdOrAssignedByMe); break;
    case 'all': items = all; break;
    case 'review': items = all.filter((x) => x.pendingReviews > 0); break;
    default: items = all.filter((x) => x.assignedToMe && x.status !== P.Draft);
  }
  if (q.status.length) items = items.filter((x) => q.status.includes(x.status));
  if (q.categoryId != null) items = items.filter((x) => x.categoryId === q.categoryId);
  if (q.priority != null) items = items.filter((x) => x.priority === q.priority);
  if (q.unitId != null) items = items.filter((x) => x.unitId === q.unitId);
  if (q.overdue) items = items.filter((x) => x.overdue);
  if (q.dueSoon) items = items.filter((x) => x.dueSoon);
  if (q.search && q.search.trim()) {
    const needle = normalize(q.search);
    items = items.filter((x) => normalize(`${x.title} ${x.unitName} ${x.assignees.map((a) => a.name).join(' ')}`).includes(needle));
  }
  const closed = (x: TaskSummaryDto) => (x.status === P.Done || x.status === P.Cancelled ? 1 : 0);
  const due = (x: TaskSummaryDto) => (x.due ? Date.parse(x.due) : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => closed(a) - closed(b) || Number(b.overdue) - Number(a.overdue) || due(a) - due(b) || b.priority - a.priority);
  return { items, counts };
}

export const toFile = (f: FileRow): FileDto => ({
  id: f.MaTep, name: f.TenTep, size: f.KichThuoc, contentType: f.LoaiTep, uploadedAt: iso(f.NgayTaiLen)!, downloadable: f.DuongDan.startsWith(FILE_PREFIX),
});

export const toExtension = (x: ExtensionRow): ExtensionDto => ({
  id: x.MaYeuCau, oldDue: iso(x.HanCu)!, proposedDue: iso(x.HanDeXuat)!, reason: x.LyDo, status: x.TrangThai, approvedDue: iso(x.HanDuocDuyet),
  comment: x.NhanXet ?? '', requestedBy: person(x.MaNguoiYeuCau, x.TenNguoiYeuCau),
  decidedBy: x.MaNguoiDuyet != null ? person(x.MaNguoiDuyet, x.TenNguoiDuyet ?? '') : null, createdAt: iso(x.NgayTao)!, decidedAt: iso(x.NgayDuyet),
});

export const toDecline = (x: DeclineRow): DeclineDto => ({
  id: x.MaYeuCau, reason: x.LyDo, status: x.TrangThai, comment: x.NhanXet ?? '', requestedBy: person(x.MaNguoiYeuCau, x.TenNguoiYeuCau),
  decidedBy: x.MaNguoiDuyet != null ? person(x.MaNguoiDuyet, x.TenNguoiDuyet ?? '') : null, createdAt: iso(x.NgayTao)!, decidedAt: iso(x.NgayDuyet),
});

interface ProgressRow { MaTienDo: number; MaPhanCong: number; MaNguoiCapNhat: number; HoTen: string; PhanTramTienDo: number; NoiDungThucHien: string; NgayCapNhat: Date; }
interface ResultRow {
  MaKetQua: number; MaPhanCong: number; MaNguoiNop: number; TenNguoiNop: string; LanNop: number; NoiDungKetQua: string; TrangThaiNop: number; NgayNop: Date;
  QuyetDinh: number | null; NhanXet: string | null; MaNguoiDanhGia: number | null; TenNguoiDanhGia: string | null; NgayDanhGia: Date | null;
}

const FILE_COLUMNS = 'f.MaTep, f.MaCongViec, f.MaKetQua, f.MaBinhLuan, f.MaNguoiTaiLen, f.TenTep, f.DuongDan, f.LoaiTep, f.KichThuoc, f.NgayTaiLen';

export async function detail(db: SqlRunner, r: TaskRights, taskId: number): Promise<TaskDetailDto | null> {
  const s = await loadVisible(db, r, taskId);
  const t = s.tasks[0];
  if (!t) return null;
  const now = nowUtc();
  const summary = toSummary(r, s, t, now);
  const assignments = s.assignments.filter((a) => a.MaCongViec === taskId);

  const progress = await db.query<ProgressRow>(
    `SELECT x.MaTienDo, x.MaPhanCong, x.MaNguoiCapNhat, n.HoTen, x.PhanTramTienDo, x.NoiDungThucHien, x.NgayCapNhat
     FROM dbo.CapNhatTienDo AS x
     JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = x.MaNguoiCapNhat
     JOIN dbo.PhanCong AS p ON p.MaPhanCong = x.MaPhanCong
     WHERE p.MaCongViec = @taskId
     ORDER BY x.NgayCapNhat DESC, x.MaTienDo DESC;`,
    { taskId },
  );
  const results = await db.query<ResultRow>(
    `SELECT k.MaKetQua, k.MaPhanCong, k.MaNguoiNop, n.HoTen AS TenNguoiNop, k.LanNop, k.NoiDungKetQua,
            k.TrangThaiNop, k.NgayNop, d.QuyetDinh, d.NhanXet, d.MaNguoiDanhGia, nd.HoTen AS TenNguoiDanhGia, d.NgayDanhGia
     FROM dbo.KetQuaCongViec AS k
     JOIN dbo.PhanCong AS p ON p.MaPhanCong = k.MaPhanCong
     JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = k.MaNguoiNop
     OUTER APPLY (
         SELECT TOP (1) x.QuyetDinh, x.NhanXet, x.MaNguoiDanhGia, x.NgayDanhGia
         FROM dbo.DanhGia AS x WHERE x.MaKetQua = k.MaKetQua
         ORDER BY x.NgayDanhGia DESC, x.MaDanhGia DESC
     ) AS d
     LEFT JOIN dbo.NguoiDung AS nd ON nd.MaNguoiDung = d.MaNguoiDanhGia
     WHERE p.MaCongViec = @taskId
     ORDER BY k.MaPhanCong, k.LanNop DESC;`,
    { taskId },
  );
  const extensions = await db.query<ExtensionRow>(
    `SELECT g.MaYeuCau, g.MaPhanCong, g.MaNguoiYeuCau, ny.HoTen AS TenNguoiYeuCau, g.HanCu, g.HanDeXuat, g.LyDo,
            g.TrangThai, g.MaNguoiDuyet, nd.HoTen AS TenNguoiDuyet, g.HanDuocDuyet, g.NhanXet, g.NgayTao, g.NgayDuyet
     FROM dbo.YeuCauGiaHan AS g
     JOIN dbo.PhanCong AS p ON p.MaPhanCong = g.MaPhanCong
     JOIN dbo.NguoiDung AS ny ON ny.MaNguoiDung = g.MaNguoiYeuCau
     LEFT JOIN dbo.NguoiDung AS nd ON nd.MaNguoiDung = g.MaNguoiDuyet
     WHERE p.MaCongViec = @taskId
     ORDER BY g.NgayTao DESC;`,
    { taskId },
  );
  const declines = await db.query<DeclineRow>(
    `IF ${P.HAS_DECLINE_TABLE}
       SELECT y.MaYeuCau, y.MaPhanCong, y.MaNguoiYeuCau, ny.HoTen AS TenNguoiYeuCau, y.LyDo, y.TrangThai,
              y.MaNguoiDuyet, nd.HoTen AS TenNguoiDuyet, y.NhanXet, y.NgayTao, y.NgayDuyet
       FROM dbo.YeuCauTuChoi AS y
       JOIN dbo.PhanCong AS p ON p.MaPhanCong = y.MaPhanCong
       JOIN dbo.NguoiDung AS ny ON ny.MaNguoiDung = y.MaNguoiYeuCau
       LEFT JOIN dbo.NguoiDung AS nd ON nd.MaNguoiDung = y.MaNguoiDuyet
       WHERE p.MaCongViec = @taskId
       ORDER BY y.NgayTao DESC;
     ELSE SELECT TOP (0) CAST(NULL AS INT) AS MaYeuCau;`,
    { taskId },
  );
  const files = await db.query<FileRow>(
    `SELECT ${FILE_COLUMNS}
     FROM dbo.TepDinhKem AS f
     WHERE f.MaCongViec = @taskId
        OR f.MaKetQua IN (SELECT k.MaKetQua FROM dbo.KetQuaCongViec AS k JOIN dbo.PhanCong AS p ON p.MaPhanCong = k.MaPhanCong WHERE p.MaCongViec = @taskId)
     ORDER BY f.NgayTaiLen;`,
    { taskId },
  );
  const children = await db.query<TaskLinkDto>(
    'SELECT MaCongViec AS id, TieuDe AS title, CONVERT(INT, TrangThai) AS status FROM dbo.CongViec WHERE MaCongViecCha = @taskId AND TrangThai <> 0;',
    { taskId },
  );
  const parent = t.MaCongViecCha != null
    ? await db.one<TaskLinkDto>('SELECT MaCongViec AS id, TieuDe AS title, CONVERT(INT, TrangThai) AS status FROM dbo.CongViec WHERE MaCongViec = @pid;', { pid: t.MaCongViecCha })
    : null;
  const dependsOn = await db.query<TaskLinkDto>(
    `SELECT c.MaCongViec AS id, c.TieuDe AS title, CONVERT(INT, c.TrangThai) AS status
     FROM dbo.PhuThuocCongViec AS d JOIN dbo.CongViec AS c ON c.MaCongViec = d.MaCongViecTruoc
     WHERE d.MaCongViecSau = @taskId;`,
    { taskId },
  );

  const declineEnabled = !!(await db.scalar<number>(`SELECT CASE WHEN ${P.HAS_DECLINE_TABLE} THEN 1 ELSE 0 END;`));
  const readOnly = !P.related(r, t, assignments);
  const manage = !readOnly && P.canManage(r, t);
  const activeAssignments = assignments.filter(P.isActive);
  const openChildren = children.some((c) => c.status !== P.Done && c.status !== P.Cancelled);
  const running = P.isRunning(t);
  const permissions: TaskPermissionsDto = {
    canEdit: manage && t.TrangThai !== P.Done && t.TrangThai !== P.Cancelled,
    canAssign: manage && running,
    canPause: manage && running,
    canResume: manage && t.TrangThai === P.Paused,
    canCancel: manage && t.TrangThai !== P.Done && t.TrangThai !== P.Cancelled,
    canComplete: manage && (t.TrangThai === P.InProgress || t.TrangThai === P.Review) && activeAssignments.length > 0
      && activeAssignments.every((a) => a.TrangThaiPhanCong === P.AsDone) && !openChildren,
    canPublish: t.MaNguoiTao === r.userId && t.TrangThai === P.Draft,
    canComment: !readOnly && t.TrangThai !== P.Draft,
    readOnly,
  };

  const assignmentDtos: AssignmentDto[] = assignments.map((a) => {
    const aResults = results.filter((x) => x.MaPhanCong === a.MaPhanCong);
    const aExt = extensions.filter((x) => x.MaPhanCong === a.MaPhanCong);
    const pendingExt = aExt.find((x) => x.TrangThai === 0);
    const latest = [...aResults].sort((x, y) => y.LanNop - x.LanNop)[0];
    const approved = aExt.filter((x) => x.TrangThai === 1 || x.TrangThai === 2).length;
    const aDecl = declines.filter((x) => x.MaPhanCong === a.MaPhanCong);
    const pendingDecl = aDecl.find((x) => x.TrangThai === 0);
    const assignee = !readOnly && P.isAssignee(r, a);
    const canManageThis = !readOnly && (a.MaNguoiGiao === r.userId || P.canManage(r, t));
    const st = a.TrangThaiPhanCong;
    const isPerson = a.MaNguoiNhan != null;
    const name = isPerson ? a.TenNguoiNhan ?? '' : a.TenDonViNhan ?? '';
    return {
      id: a.MaPhanCong, kind: isPerson ? 'person' : 'unit', personId: a.MaNguoiNhan, unitId: a.MaDonViNhan, name,
      initials: isPerson ? initials(name) : unitInitials(name), subtitle: isPerson ? '' : 'Giao cho cả đơn vị', role: a.VaiTro,
      status: st, note: a.NoiDungGiao ?? '', assigner: person(a.MaNguoiGiao, a.TenNguoiGiao), assignerUnitId: a.MaDonViGiao,
      assignedAt: iso(a.NgayGiao)!, due: iso(a.HanHoanThanh)!, acceptedAt: iso(a.NgayTiepNhan), completedAt: iso(a.NgayHoanThanh),
      progress: Number(a.PhanTramBaoCao), overdue: P.assignmentOverdue(a, now) && running, dueSoon: P.assignmentDueSoon(a, now) && running,
      progressHistory: progress.filter((x) => x.MaPhanCong === a.MaPhanCong).map((x) => ({
        id: x.MaTienDo, percent: Number(x.PhanTramTienDo), note: x.NoiDungThucHien, at: iso(x.NgayCapNhat)!, by: person(x.MaNguoiCapNhat, x.HoTen),
      })),
      results: aResults.map((x) => ({
        id: x.MaKetQua, attempt: x.LanNop, content: x.NoiDungKetQua, status: x.TrangThaiNop, submittedAt: iso(x.NgayNop)!,
        submitter: person(x.MaNguoiNop, x.TenNguoiNop), files: files.filter((f) => f.MaKetQua === x.MaKetQua).map(toFile),
        review: x.QuyetDinh != null && x.MaNguoiDanhGia != null && x.NgayDanhGia != null
          ? { decision: x.QuyetDinh, comment: x.NhanXet ?? '', reviewer: person(x.MaNguoiDanhGia, x.TenNguoiDanhGia ?? '?'), at: iso(x.NgayDanhGia)! }
          : null,
      })),
      extensions: aExt.map(toExtension),
      approvedExtensions: approved,
      declines: aDecl.map(toDecline),
      actions: {
        canAccept: assignee && st === P.AsWaiting && running,
        canReject: assignee && st === P.AsWaiting && running && !pendingDecl,
        canDelegate: !readOnly && P.isUnitManagerOf(r, a) && P.isOpen(a) && running,
        canUpdateProgress: assignee && (st === P.AsAccepted || st === P.AsWorking) && running,
        canSubmit: assignee && (st === P.AsAccepted || st === P.AsWorking) && running,
        canEvaluate: !readOnly && latest?.TrangThaiNop === 0 && st === P.AsReview && P.canEvaluate(r, t, a),
        canRequestExtension: assignee && P.isOpen(a) && running && !pendingExt && !pendingDecl && approved < P.MAX_APPROVED_EXTENSIONS,
        canDecideExtension: !readOnly && !!pendingExt && P.canDecideExtension(r, t, a, pendingExt.MaNguoiYeuCau),
        // Đang chờ duyệt xin từ chối: người giao chỉ cần quyết định (Đồng ý đã thay cho Hủy phân công; không nhắc người đang xin thôi).
        canCancel: canManageThis && !pendingDecl && (st === P.AsWaiting || st === P.AsAccepted || st === P.AsWorking || st === P.AsReview),
        canRemind: canManageThis && !pendingDecl && P.isOpen(a) && running,
        // Chưa tiếp nhận dùng "Từ chối" (canReject), đã tiếp nhận dùng "Xin từ chối"; cả hai đều chờ người giao duyệt.
        canRequestDecline: assignee && (st === P.AsAccepted || st === P.AsWorking) && running && !pendingDecl && declineEnabled,
        canDecideDecline: !readOnly && !!pendingDecl && P.canDecideDecline(r, t, a, pendingDecl.MaNguoiYeuCau),
      },
    };
  });

  return {
    summary, description: t.MoTa ?? '', criteria: t.TieuChiHoanThanh ?? '', templateId: t.MaMauCongViec, parent, children, dependsOn,
    files: files.filter((f) => f.MaCongViec === taskId).map(toFile), assignments: assignmentDtos,
    pendingExtensions: extensions.filter((x) => x.TrangThai === 0).length, permissions,
  };
}

export async function comments(db: SqlRunner, taskId: number): Promise<CommentDto[]> {
  const rows = await db.query<{ MaBinhLuan: number; MaBinhLuanCha: number | null; NoiDung: string; MaNguoiViet: number; HoTen: string; NgayTao: Date; NgayCapNhat: Date | null }>(
    `SELECT b.MaBinhLuan, b.MaBinhLuanCha, b.NoiDung, b.MaNguoiViet, n.HoTen, b.NgayTao, b.NgayCapNhat
     FROM dbo.BinhLuan AS b JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = b.MaNguoiViet
     WHERE b.MaCongViec = @taskId
     ORDER BY b.NgayTao, b.MaBinhLuan;`,
    { taskId },
  );
  const files = await db.query<FileRow>(
    `SELECT ${FILE_COLUMNS} FROM dbo.TepDinhKem AS f JOIN dbo.BinhLuan AS b ON b.MaBinhLuan = f.MaBinhLuan WHERE b.MaCongViec = @taskId;`,
    { taskId },
  );
  return rows.map((c) => ({
    id: c.MaBinhLuan, parentId: c.MaBinhLuanCha, content: c.NoiDung, author: person(c.MaNguoiViet, c.HoTen),
    createdAt: iso(c.NgayTao)!, updatedAt: iso(c.NgayCapNhat), files: files.filter((f) => f.MaBinhLuan === c.MaBinhLuan).map(toFile),
  }));
}

export async function history(db: SqlRunner, taskId: number): Promise<HistoryDto[]> {
  const rows = await db.query<{ MaLichSu: number; LoaiHanhDong: string; MoTa: string | null; TruongThayDoi: string | null; GiaTriCu: string | null; GiaTriMoi: string | null; MaNguoiThucHien: number | null; HoTen: string | null; ThoiGian: Date }>(
    `SELECT l.MaLichSu, l.LoaiHanhDong, l.MoTa, l.TruongThayDoi, l.GiaTriCu, l.GiaTriMoi, l.MaNguoiThucHien, n.HoTen, l.ThoiGian
     FROM dbo.LichSuCongViec AS l LEFT JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = l.MaNguoiThucHien
     WHERE l.MaCongViec = @taskId
     ORDER BY l.ThoiGian DESC, l.MaLichSu DESC;`,
    { taskId },
  );
  // Cột MoTa ghi kèm tên người làm ("Nguyễn Hồng Vũ bình luận") để đọc thẳng trong CSDL vẫn hiểu; còn người làm
  // đã có ở trường `by` nên bỏ tên ở đầu mô tả, tránh giao diện hiện lặp "Nguyễn Hồng Vũ Nguyễn Hồng Vũ bình luận".
  // Không sửa dữ liệu cũ trong bảng: lịch sử là nhật ký chỉ ghi thêm.
  const withoutActor = (text: string, name: string | null) =>
    name && text.startsWith(name + ' ') ? text.slice(name.length + 1) : text;
  return rows.map((h) => ({
    id: h.MaLichSu, type: h.LoaiHanhDong, description: withoutActor(h.MoTa ?? '', h.HoTen), field: h.TruongThayDoi, oldValue: h.GiaTriCu, newValue: h.GiaTriMoi,
    by: h.MaNguoiThucHien != null ? person(h.MaNguoiThucHien, h.HoTen ?? '?') : null, at: iso(h.ThoiGian)!,
  }));
}

/** Người và đơn vị có thể nhận việc: thành viên đang hoạt động của các đơn vị trong phạm vi giao việc. */
export async function assignOptions(db: SqlRunner, unitIds: number[]): Promise<AssignOptionsDto> {
  if (unitIds.length === 0) return { people: [], units: [] };
  const people = await db.query<{ MaNguoiDung: number; HoTen: string; TenDonVi: string | null; SoViecDangMo: number }>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT n.MaNguoiDung, n.HoTen,
            (SELECT TOP (1) d.TenDonVi FROM dbo.ThanhVienDonVi AS t2 JOIN dbo.DonVi AS d ON d.MaDonVi = t2.MaDonVi
              WHERE t2.MaNguoiDung = n.MaNguoiDung AND t2.TrangThai = 1 AND t2.MaDonVi IN @unitIds
              ORDER BY t2.LaDonViChinh DESC, d.TenDonVi) AS TenDonVi,
            (SELECT COUNT(*) FROM dbo.PhanCong AS p JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
              WHERE p.MaNguoiNhan = n.MaNguoiDung AND p.TrangThaiPhanCong IN (0, 1, 2) AND c.TrangThai IN (1, 2, 3)) AS SoViecDangMo
     FROM dbo.NguoiDung AS n
     WHERE n.TrangThaiTaiKhoan = 1
       AND EXISTS (SELECT 1 FROM dbo.ThanhVienDonVi AS tv
                   WHERE tv.MaNguoiDung = n.MaNguoiDung AND tv.MaDonVi IN @unitIds AND tv.TrangThai = 1
                     AND tv.NgayThamGia <= @HomNay AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay))
     ORDER BY n.HoTen;`,
    { unitIds },
  );
  const units = await db.query<{ MaDonVi: number; TenDonVi: string; LoaiDonVi: string }>(
    'SELECT MaDonVi, TenDonVi, LoaiDonVi FROM dbo.DonVi WHERE TrangThai = 1 AND MaDonVi IN @unitIds ORDER BY TenDonVi;',
    { unitIds },
  );
  return {
    people: people.map((p) => ({ id: p.MaNguoiDung, name: p.HoTen, initials: initials(p.HoTen), unitName: p.TenDonVi ?? '', openTasks: p.SoViecDangMo })),
    units: units.map((u) => ({ id: u.MaDonVi, name: u.TenDonVi, type: unitTypeLabel(u.LoaiDonVi) })),
  };
}

/** Cảnh báo sau đăng nhập: việc mình làm hoặc mình quản lý đã quá hạn / còn ≤ 3 ngày. */
export async function dueAlert(db: SqlRunner, r: TaskRights): Promise<DueAlertDto> {
  const s = await loadVisible(db, r);
  const now = nowUtc();
  const items: DueAlertItemDto[] = [];
  for (const t of s.tasks.filter(P.isRunning)) {
    const mine = s.assignments.filter((a) => a.MaCongViec === t.MaCongViec && P.isOpen(a) && P.isAssignee(r, a));
    for (const a of mine) {
      if (P.assignmentOverdue(a, now) || P.assignmentDueSoon(a, now))
        items.push({ taskId: t.MaCongViec, assignmentId: a.MaPhanCong, title: t.TieuDe, unitName: t.TenDonVi, due: iso(a.HanHoanThanh)!, progress: Number(a.PhanTramBaoCao), overdue: a.HanHoanThanh < now, relation: 'assignee' });
    }
    const manages = t.MaNguoiTao === r.userId || s.assignments.some((a) => a.MaCongViec === t.MaCongViec && a.MaNguoiGiao === r.userId);
    if (mine.length === 0 && manages && t.HanHoanThanh && (P.isOverdue(t.HanHoanThanh, t.TrangThai, now) || P.isDueSoon(t.HanHoanThanh, t.TrangThai, now)))
      items.push({ taskId: t.MaCongViec, assignmentId: null, title: t.TieuDe, unitName: t.TenDonVi, due: iso(t.HanHoanThanh)!, progress: Number(t.PhanTramTienDo), overdue: t.HanHoanThanh < now, relation: 'manager' });
  }
  const byDue = (a: DueAlertItemDto, b: DueAlertItemDto) => Date.parse(a.due) - Date.parse(b.due);
  return { overdue: items.filter((x) => x.overdue).sort(byDue), dueSoon: items.filter((x) => !x.overdue).sort(byDue) };
}
