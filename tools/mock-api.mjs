// Máy chủ API GIẢ LẬP (chỉ để kiểm thử giao diện khi chưa có SQL Server).
// Trả dữ liệu đúng định dạng DTO của packages/shared; logic nghiệp vụ rút gọn.
// Chạy: node tools/mock-api.mjs  → http://localhost:5199 (phục vụ luôn apps/web/dist)
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage() });
const DAY = 86400000;
const now = () => new Date();
const iso = (d) => (d ? new Date(d).toISOString() : null);
const days = (n) => new Date(Date.now() + n * DAY);
const initials = (name) => name.split(' ').filter(Boolean).slice(-2).map((w) => w[0].toUpperCase()).join('');
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// ---------------- Dữ liệu mẫu ----------------
const units = [
  { id: 1, name: 'Khoa Công nghệ Thông tin', type: 'Khoa', parentId: null, active: true, description: 'Khoa CNTT' },
  { id: 2, name: 'Bộ môn Khoa học dữ liệu', type: 'Bộ môn', parentId: 1, active: true, description: '' },
  { id: 3, name: 'Bộ môn Hệ thống thông tin', type: 'Bộ môn', parentId: 1, active: true, description: '' },
  { id: 4, name: 'Ban Tuyển sinh Khoa', type: 'Ban', parentId: 1, active: true, description: '' },
];
const people = [
  { id: 1, name: 'Quản Trị Demo', email: 'admin.demo@example.invalid', admin: true },
  { id: 2, name: 'Nguyễn Hồng Vũ', email: 'vunh@huit.edu.vn' },
  { id: 3, name: 'Phạm Thái Bảo', email: 'baopt@huit.edu.vn' },
  { id: 4, name: 'Ngô Dương Hà', email: 'hand@huit.edu.vn' },
  { id: 5, name: 'Lê Thị Mai', email: 'mailt@huit.edu.vn' },
].map((p) => ({ ...p, active: true, academicTitle: '', degree: 'Thạc sĩ', training: '', phone: '', password: 'Demo@CNTT2026!' }));
const P0 = { createTask: false, assignTask: false, approveResult: false, evaluateResult: false, viewReport: false, manageMembers: false, includeChildren: false };
const roles = [
  { id: 1, name: 'Trưởng khoa', description: '', active: true, permissions: { createTask: true, assignTask: true, approveResult: true, evaluateResult: true, viewReport: true, manageMembers: true, includeChildren: true } },
  { id: 2, name: 'Trưởng bộ môn', description: '', active: true, permissions: { createTask: true, assignTask: true, approveResult: true, evaluateResult: true, viewReport: true, manageMembers: true, includeChildren: false } },
  { id: 3, name: 'Giảng viên', description: '', active: true, permissions: { ...P0 } },
  { id: 4, name: 'Ủy viên', description: '', active: true, permissions: { ...P0 } },
];
const memberships = [
  { personId: 2, unitId: 1, roleId: 1, primary: true, start: '2024-01-01', end: '' },
  { personId: 3, unitId: 2, roleId: 2, primary: true, start: '2024-01-01', end: '' },
  { personId: 4, unitId: 2, roleId: 3, primary: true, start: '2024-01-01', end: '' },
  { personId: 4, unitId: 4, roleId: 4, primary: false, start: '2025-09-01', end: '' },
  { personId: 5, unitId: 3, roleId: 3, primary: true, start: '2024-01-01', end: '' },
];
const categories = [
  { id: 1, name: 'Đào tạo', description: 'Đề cương, chương trình', active: true },
  { id: 2, name: 'Tuyển sinh', description: '', active: true },
  { id: 3, name: 'Nghiên cứu khoa học', description: '', active: true },
];
let seq = 200;
const tasks = [
  { id: 101, title: 'Xây dựng đề cương học phần Học máy', description: 'Theo mẫu mới', criteria: 'Bộ môn thông qua', categoryId: 1, priority: 3, start: days(-10), due: days(6), status: 2, progress: 57, createdAt: days(-12), completedAt: null, unitId: 2, creatorId: 3, parentId: null, templateId: null, dependsOn: [] },
  { id: 102, title: 'Tư vấn tuyển sinh thạc sĩ đợt 2', description: '', criteria: '', categoryId: 2, priority: 2, start: days(-20), due: days(-4), status: 2, progress: 20, createdAt: days(-21), completedAt: null, unitId: 1, creatorId: 2, parentId: null, templateId: null, dependsOn: [] },
  { id: 103, title: 'Cập nhật chương trình đào tạo CNTT 2026', description: '', criteria: '', categoryId: 1, priority: 4, start: days(-5), due: days(2), status: 1, progress: 0, createdAt: days(-5), completedAt: null, unitId: 1, creatorId: 2, parentId: null, templateId: null, dependsOn: [] },
  { id: 104, title: 'Tổ chức hội thảo Khoa học dữ liệu 2026', description: '', criteria: '', categoryId: 3, priority: 2, start: days(-30), due: days(10), status: 3, progress: 99, createdAt: days(-31), completedAt: null, unitId: 2, creatorId: 3, parentId: null, templateId: null, dependsOn: [] },
  { id: 105, title: 'Báo cáo tổng kết học kỳ', description: '', criteria: '', categoryId: 1, priority: 2, start: days(-60), due: days(-30), status: 4, progress: 100, createdAt: days(-61), completedAt: days(-32), unitId: 2, creatorId: 3, parentId: null, templateId: null, dependsOn: [] },
];
const assignments = [
  { id: 1, taskId: 101, giver: 3, giverUnit: 2, personId: 4, unitId: null, note: '', status: 2, assignedAt: days(-11), due: days(6), acceptedAt: days(-10), completedAt: null, role: 1 },
  { id: 2, taskId: 102, giver: 2, giverUnit: 1, personId: 4, unitId: null, note: '', status: 2, assignedAt: days(-20), due: days(-4), acceptedAt: days(-19), completedAt: null, role: 2 },
  { id: 3, taskId: 103, giver: 2, giverUnit: 1, personId: null, unitId: 2, note: 'Ưu tiên chuẩn đầu ra', status: 0, assignedAt: days(-4), due: days(2), acceptedAt: null, completedAt: null, role: null },
  { id: 4, taskId: 104, giver: 3, giverUnit: 2, personId: 4, unitId: null, note: '', status: 3, assignedAt: days(-29), due: days(10), acceptedAt: days(-28), completedAt: null, role: 2 },
  { id: 5, taskId: 105, giver: 3, giverUnit: 2, personId: 4, unitId: null, note: '', status: 4, assignedAt: days(-59), due: days(-30), acceptedAt: days(-58), completedAt: days(-32), role: 1 },
  { id: 6, taskId: 103, giver: 2, giverUnit: 1, personId: 5, unitId: null, note: '', status: 0, assignedAt: days(-4), due: days(2), acceptedAt: null, completedAt: null, role: 2 },
];
const progress = [{ id: 1, aid: 1, by: 4, percent: 57, note: 'Xong chương 1–4', at: days(-1) }, { id: 2, aid: 2, by: 4, percent: 20, note: 'Đã liên hệ 10 hồ sơ', at: days(-6) }];
const results = [
  { id: 1, aid: 4, by: 4, attempt: 1, content: 'Đã gửi kế hoạch hội thảo', status: 0, at: days(-1), review: null },
  { id: 2, aid: 5, by: 4, attempt: 1, content: 'Báo cáo đính kèm', status: 1, at: days(-33), review: { decision: 1, comment: 'Tốt', by: 3, at: days(-32) } },
];
const extensions = [{ id: 1, aid: 2, by: 4, oldDue: days(-4), proposedDue: days(5), reason: 'Chờ hồ sơ bổ sung', status: 0, approvedDue: null, comment: '', decidedBy: null, createdAt: days(-2), decidedAt: null }];
const comments = [{ id: 1, taskId: 101, parentId: null, by: 3, content: 'Nhớ cập nhật CLO.', at: days(-2) }];
const history = [{ id: 1, taskId: 101, type: 'GiaoViec', description: 'Giao cho Ngô Dương Hà (chủ trì)', field: null, oldValue: null, newValue: null, by: 3, at: days(-11) }];
const notifications = [
  { id: 1, to: 4, type: 'QuaHan', level: 2, title: 'Quá hạn: Tư vấn tuyển sinh thạc sĩ đợt 2', content: 'Đã quá hạn. Cập nhật tiến độ hoặc xin gia hạn.', taskId: 102, read: false, needsAction: false, createdAt: days(-0.01) },
  { id: 2, to: 3, type: 'KetQua', level: 0, title: 'Kết quả chờ duyệt: Tổ chức hội thảo', content: 'Ngô Dương Hà nộp kết quả lần 1.', taskId: 104, read: false, needsAction: true, createdAt: days(-1) },
];
const templates = [{ id: 1, name: 'Ra đề thi cuối kỳ', title: 'Ra đề thi cuối kỳ', description: '', criteria: '', categoryId: 1, priority: 2, unitId: 2, durationDays: 14, recurrence: 1, nextRun: '2027-01-15', timesUsed: 3, active: true, creatorId: 3 }];
const audit = [{ id: 1, action: 'DangNhap', objectType: 'NguoiDung', objectId: '1', actor: 'Quản Trị Demo', ip: '127.0.0.1', at: days(-0.1) }];

// ---------------- Quyền ----------------
const personOf = (id) => people.find((p) => p.id === id);
const unitOf = (id) => units.find((u) => u.id === id);
const nameOf = (id) => personOf(id)?.name ?? '';
const ref = (id) => ({ id, name: nameOf(id), initials: initials(nameOf(id)) });
const children = (uid) => units.filter((u) => u.parentId === uid).flatMap((u) => [u.id, ...children(u.id)]);
function rights(uid) {
  const r = { uid, admin: !!personOf(uid)?.admin, member: new Set(), create: new Set(), assign: new Set(), direct: new Set(), review: new Set(), report: new Set() };
  for (const m of memberships.filter((x) => x.personId === uid)) {
    const role = roles.find((x) => x.id === m.roleId);
    const scope = [m.unitId, ...(role.permissions.includeChildren ? children(m.unitId) : [])];
    r.member.add(m.unitId);
    if (role.permissions.createTask) scope.forEach((u) => r.create.add(u));
    if (role.permissions.assignTask) { scope.forEach((u) => r.assign.add(u)); r.direct.add(m.unitId); }
    if (role.permissions.approveResult || role.permissions.evaluateResult) scope.forEach((u) => r.review.add(u));
    if (role.permissions.viewReport) scope.forEach((u) => r.report.add(u));
  }
  r.view = new Set([...r.create, ...r.assign, ...r.review, ...r.report]);
  return r;
}
const isAssignee = (r, a) => a.personId === r.uid || (a.unitId != null && r.direct.has(a.unitId));
const canManage = (r, t) => t.creatorId === r.uid || r.assign.has(t.unitId);
const running = (t) => [1, 2, 3].includes(t.status);
const open = (a) => [0, 1, 2].includes(a.status);
const visible = (r, t) => (t.status !== 0 || t.creatorId === r.uid) && (r.admin || t.creatorId === r.uid || r.view.has(t.unitId) || assignments.some((a) => a.taskId === t.id && (a.personId === r.uid || a.giver === r.uid || (a.unitId && r.assign.has(a.unitId)))));

function summary(r, t) {
  const mine = assignments.filter((a) => a.taskId === t.id), active = mine.filter((a) => a.status < 5);
  const my = active.filter((a) => isAssignee(r, a)).sort((a, b) => (open(a) ? 0 : 1) - (open(b) ? 0 : 1))[0];
  let pending = 0;
  for (const a of mine) {
    const latest = results.filter((x) => x.aid === a.id).sort((x, y) => y.attempt - x.attempt)[0];
    if (latest?.status === 0 && a.personId !== r.uid && (a.giver === r.uid || r.review.has(t.unitId))) pending++;
    const ext = extensions.find((x) => x.aid === a.id && x.status === 0);
    if (ext && ext.by !== r.uid && (a.giver === r.uid || r.assign.has(t.unitId))) pending++;
  }
  const n = now();
  const repProgress = (a) => (a.status === 4 ? 100 : progress.filter((p) => p.aid === a.id).sort((x, y) => y.at - x.at)[0]?.percent ?? (a.status === 3 ? 100 : 0));
  return {
    id: t.id, title: t.title, status: t.status, priority: t.priority, progress: t.progress, start: iso(t.start), due: iso(t.due), createdAt: iso(t.createdAt), completedAt: iso(t.completedAt),
    unitId: t.unitId, unitName: unitOf(t.unitId).name, categoryId: t.categoryId, categoryName: categories.find((c) => c.id === t.categoryId)?.name ?? '',
    creatorId: t.creatorId, creatorName: nameOf(t.creatorId), parentId: t.parentId,
    overdue: !!t.due && t.due < n && [1, 2].includes(t.status), dueSoon: !!t.due && t.due >= n && t.due - n <= 3 * DAY && [1, 2].includes(t.status),
    assignees: active.map((a) => a.personId ? { kind: 'person', id: a.personId, name: nameOf(a.personId), initials: initials(nameOf(a.personId)), status: a.status } : { kind: 'unit', id: a.unitId, name: unitOf(a.unitId).name, initials: 'KD', status: a.status }),
    assignedToMe: active.some((a) => isAssignee(r, a)), createdOrAssignedByMe: t.creatorId === r.uid || mine.some((a) => a.giver === r.uid), pendingReviews: pending,
    myAssignmentId: my?.id ?? null, myAssignmentStatus: my?.status ?? null, myProgress: my ? repProgress(my) : null, myDue: iso(my?.due), myRole: my?.role ?? null,
    _rep: repProgress,
  };
}
function detail(r, t) {
  const s = summary(r, t); const rep = s._rep; delete s._rep;
  const mine = assignments.filter((a) => a.taskId === t.id);
  const related = t.creatorId === r.uid || r.view.has(t.unitId) || mine.some((a) => a.giver === r.uid || isAssignee(r, a));
  const readOnly = !related, manage = !readOnly && canManage(r, t), n = now();
  const active = mine.filter((a) => a.status < 5);
  return {
    summary: s, description: t.description, criteria: t.criteria, templateId: t.templateId, parent: null, children: [], dependsOn: [], files: [],
    assignments: mine.map((a) => {
      const res = results.filter((x) => x.aid === a.id).sort((x, y) => y.attempt - x.attempt);
      const ext = extensions.filter((x) => x.aid === a.id);
      const pendingExt = ext.find((x) => x.status === 0), approved = ext.filter((x) => [1, 2].includes(x.status)).length;
      const asg = !readOnly && isAssignee(r, a), manageThis = !readOnly && (a.giver === r.uid || canManage(r, t));
      return {
        id: a.id, kind: a.personId ? 'person' : 'unit', personId: a.personId, unitId: a.unitId, name: a.personId ? nameOf(a.personId) : unitOf(a.unitId).name,
        initials: a.personId ? initials(nameOf(a.personId)) : 'KD', subtitle: '', role: a.role, status: a.status, note: a.note, assigner: ref(a.giver), assignerUnitId: a.giverUnit,
        assignedAt: iso(a.assignedAt), due: iso(a.due), acceptedAt: iso(a.acceptedAt), completedAt: iso(a.completedAt), progress: rep(a),
        overdue: open(a) && a.due < n && running(t), dueSoon: open(a) && a.due >= n && a.due - n <= 3 * DAY && running(t),
        progressHistory: progress.filter((p) => p.aid === a.id).sort((x, y) => y.at - x.at).map((p) => ({ id: p.id, percent: p.percent, note: p.note, at: iso(p.at), by: ref(p.by) })),
        results: res.map((x) => ({ id: x.id, attempt: x.attempt, content: x.content, status: x.status, submittedAt: iso(x.at), submitter: ref(x.by), files: [], review: x.review ? { decision: x.review.decision, comment: x.review.comment, reviewer: ref(x.review.by), at: iso(x.review.at) } : null })),
        extensions: ext.map((x) => ({ id: x.id, oldDue: iso(x.oldDue), proposedDue: iso(x.proposedDue), reason: x.reason, status: x.status, approvedDue: iso(x.approvedDue), comment: x.comment, requestedBy: ref(x.by), decidedBy: x.decidedBy ? ref(x.decidedBy) : null, createdAt: iso(x.createdAt), decidedAt: iso(x.decidedAt) })),
        approvedExtensions: approved,
        declines: [],
        actions: {
          canAccept: asg && a.status === 0 && running(t), canReject: asg && a.status === 0 && running(t),
          canDelegate: !readOnly && a.unitId != null && r.direct.has(a.unitId) && open(a) && running(t),
          canUpdateProgress: asg && [1, 2].includes(a.status) && running(t), canSubmit: asg && [1, 2].includes(a.status) && running(t),
          canEvaluate: !readOnly && res[0]?.status === 0 && a.status === 3 && a.personId !== r.uid && (a.giver === r.uid || r.review.has(t.unitId)),
          canRequestExtension: asg && open(a) && running(t) && !pendingExt && approved < 2,
          canDecideExtension: !readOnly && !!pendingExt && pendingExt.by !== r.uid && (a.giver === r.uid || r.assign.has(t.unitId)),
          canCancel: manageThis && a.status <= 3, canRemind: manageThis && open(a) && running(t),
          canRequestDecline: false, canDecideDecline: false,
        },
      };
    }),
    pendingExtensions: extensions.filter((x) => x.status === 0 && mine.some((a) => a.id === x.aid)).length,
    permissions: {
      canEdit: manage && ![4, 6].includes(t.status), canAssign: manage && running(t), canPause: manage && running(t), canResume: manage && t.status === 5,
      canCancel: manage && ![4, 6].includes(t.status), canComplete: manage && [2, 3].includes(t.status) && active.length > 0 && active.every((a) => a.status === 4),
      canPublish: t.creatorId === r.uid && t.status === 0, canComment: !readOnly && t.status !== 0, readOnly,
    },
  };
}
function sync(t) {
  const active = assignments.filter((a) => a.taskId === t.id && a.status < 5);
  if (!active.length || !running(t)) return;
  const all = active.every((a) => [3, 4].includes(a.status)), started = active.some((a) => a.status >= 1);
  t.status = all ? 3 : started ? 2 : 1;
}
const notify = (to, taskId, type, title, content) => notifications.push({ id: ++seq, to, type, level: 0, title, content, taskId, read: false, needsAction: false, createdAt: new Date() });

// ---------------- Phiên đăng nhập ----------------
const sessions = new Map();
function session(uid) {
  const p = personOf(uid), r = rights(uid);
  const mine = memberships.filter((m) => m.personId === uid).map((m) => ({ ...m, role: roles.find((x) => x.id === m.roleId), unit: unitOf(m.unitId) }));
  const portals = [];
  if (p.admin) portals.push({ key: 'admin', roleLabel: 'Quản trị hệ thống', title: 'Trang quản trị', scope: 'Quản lý tài khoản, cơ cấu tổ chức, chức vụ và quyền.' });
  // Trang Trưởng khoa / Trang bộ môn đã gộp vào Trang cá nhân (giống máy chủ thật).
  if (mine.length || !portals.length) portals.push({ key: 'ca-nhan', roleLabel: mine.length ? [...new Set(mine.map((m) => m.role.name))].join(', ') : 'Người dùng', title: 'Trang cá nhân', scope: mine.length ? mine.map((m) => m.unit.name).join(', ') : 'Chưa thuộc đơn vị nào' });
  const manageable = p.admin ? units.map((u) => u.id) : [...new Set(mine.filter((m) => m.role.permissions.manageMembers).flatMap((m) => [m.unitId, ...(m.role.permissions.includeChildren ? children(m.unitId) : [])]))];
  return {
    user: { id: uid, name: p.name, initials: initials(p.name), email: p.email, isSystemAdmin: !!p.admin, roleSummary: mine.map((m) => m.role.name).join(', ') || (p.admin ? 'Quản trị viên hệ thống' : 'Chưa có chức vụ') },
    capabilities: { canCreateUnit: !!p.admin, canEditRoles: !!p.admin, manageableUnitIds: manageable },
    portals,
    tasks: { createUnitIds: [...r.create], assignUnitIds: [...r.assign], reviewUnitIds: [...r.review], reportUnitIds: [...r.report], isMember: r.member.size > 0 },
  };
}
const err = (res, status, message, errors) => res.status(status).json(errors ? { message, errors } : { message });
function auth(req, res, next) {
  const uid = sessions.get(req.cookies.khoa_at);
  if (!uid) return err(res, 401, 'Vui lòng đăng nhập.');
  req.uid = uid; req.r = rights(uid); next();
}
app.post('/api/auth/login', (req, res) => {
  const p = people.find((x) => x.email.toLowerCase() === String(req.body.email || '').toLowerCase());
  if (!req.body.email || !req.body.password) return err(res, 400, 'Vui lòng kiểm tra.', { ...(req.body.email ? {} : { email: 'Nhập email đăng nhập.' }), ...(req.body.password ? {} : { password: 'Nhập mật khẩu.' }) });
  if (!p || p.password !== req.body.password || !p.active) return err(res, 401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản đang bị khóa.');
  const token = 't' + Math.random().toString(36).slice(2);
  sessions.set(token, p.id);
  res.cookie('khoa_at', token, { httpOnly: true, sameSite: 'strict', path: '/' });
  res.json(session(p.id));
});
app.post('/api/auth/refresh', (req, res) => err(res, 401, 'Vui lòng đăng nhập.'));
app.get('/api/auth/me', auth, (req, res) => res.json(session(req.uid)));
app.post('/api/auth/logout', auth, (req, res) => { sessions.delete(req.cookies.khoa_at); res.clearCookie('khoa_at', { path: '/' }); res.status(204).end(); });
app.post('/api/auth/doi-mat-khau', auth, (req, res) => {
  const p = personOf(req.uid);
  if (p.password !== req.body.currentPassword) return err(res, 400, 'Sai', { currentPassword: 'Mật khẩu hiện tại không đúng.' });
  p.password = req.body.newPassword; res.status(204).end();
});
app.get('/api/health', (req, res) => res.json({ database: 'mock', customUnitTypes: true, taskModule: true, server: 'mock' }));
app.use('/api', auth);

// ---------------- Tổ chức ----------------
const personDto = (p) => ({ id: p.id, employeeCode: `ND${String(p.id).padStart(3, '0')}`, name: p.name, initials: initials(p.name), email: p.email, degree: p.degree, academicTitle: p.academicTitle, training: p.training, phone: p.phone, active: p.active, isSystemAdmin: !!p.admin });
app.get('/api/to-chuc', (req, res) => res.json({ units: units.map((u) => ({ ...u, code: String(u.id) })), people: people.map(personDto), roles, memberships }));
app.get('/api/trang/:key', (req, res) => {
  const p = session(req.uid).portals.find((x) => x.key === req.params.key);
  return p ? res.json(p) : err(res, 403, 'Tài khoản của bạn không có vai trò để vào trang này.');
});
app.put('/api/chuc-vu/:id/quyen', (req, res) => {
  if (!req.r.admin) return err(res, 403, 'Chỉ quản trị hệ thống được thay đổi quyền của chức vụ.');
  const role = roles.find((x) => x.id === Number(req.params.id)); Object.keys(role.permissions).forEach((k) => (role.permissions[k] = req.body[k] === true)); res.json(role);
});
app.post('/api/don-vi', (req, res) => {
  const u = { id: ++seq, name: req.body.name, type: req.body.type, parentId: req.body.parentId, active: req.body.active, description: req.body.description };
  units.push(u); res.status(201).json({ unit: { ...u, code: String(u.id) }, createdParent: null });
});
app.post('/api/thanh-vien', (req, res) => { const m = { ...req.body }; memberships.push(m); res.status(201).json(m); });
app.post('/api/nhan-su', (req, res) => { const p = { id: ++seq, ...req.body, admin: req.body.isSystemAdmin, password: 'Tam@12345' }; people.push(p); res.status(201).json({ person: personDto(p), temporaryPassword: 'Tam@12345' }); });
app.put('/api/nhan-su/:id', (req, res) => { const p = personOf(Number(req.params.id)); Object.assign(p, req.body, { admin: req.body.isSystemAdmin }); res.json(personDto(p)); });
app.put('/api/nhan-su/:id/trang-thai', (req, res) => { const p = personOf(Number(req.params.id)); p.active = req.body.active; res.json(personDto(p)); });
app.post('/api/nhan-su/:id/cap-lai-mat-khau', (req, res) => res.json({ personId: Number(req.params.id), temporaryPassword: 'Moi@12345' }));
app.delete('/api/nhan-su/:id', (req, res) => err(res, 409, 'Tài khoản đã có lịch sử: nhật ký đăng nhập/thao tác (3). Hãy dùng Khóa tài khoản.'));

// ---------------- Công việc ----------------
app.get('/api/cong-viec', (req, res) => {
  const r = req.r, all = tasks.filter((t) => visible(r, t)).map((t) => { const s = summary(r, t); delete s._rep; return s; });
  const counts = { assigned: all.filter((x) => x.assignedToMe && x.status !== 0).length, created: all.filter((x) => x.createdOrAssignedByMe).length, all: all.length, review: all.filter((x) => x.pendingReviews > 0).length, overdue: all.filter((x) => x.overdue).length };
  const scope = req.query.scope || 'assigned';
  const items = scope === 'created' ? all.filter((x) => x.createdOrAssignedByMe) : scope === 'all' ? all : scope === 'review' ? all.filter((x) => x.pendingReviews > 0) : all.filter((x) => x.assignedToMe && x.status !== 0);
  res.json({ items, counts });
});
app.get('/api/cong-viec/lua-chon-giao-viec', (req, res) => {
  const r = req.r;
  let scope = req.query.assignmentId ? [assignments.find((a) => a.id === Number(req.query.assignmentId))?.unitId].filter((u) => r.direct.has(u)) : [...new Set([...r.assign, ...r.create])];
  const ppl = people.filter((p) => memberships.some((m) => m.personId === p.id && scope.includes(m.unitId)));
  res.json({ people: ppl.map((p) => ({ id: p.id, name: p.name, initials: initials(p.name), unitName: unitOf(memberships.find((m) => m.personId === p.id && scope.includes(m.unitId)).unitId).name, openTasks: assignments.filter((a) => a.personId === p.id && open(a)).length })), units: units.filter((u) => scope.includes(u.id)).map((u) => ({ id: u.id, name: u.name, type: u.type })) });
});
const taskOr404 = (req, res) => { const t = tasks.find((x) => x.id === Number(req.params.id)); if (!t || !visible(req.r, t)) { err(res, 404, 'Không tìm thấy công việc hoặc bạn không có quyền xem.'); return null; } return t; };
app.get('/api/cong-viec/:id', (req, res) => { const t = taskOr404(req, res); if (t) res.json(detail(req.r, t)); });
app.get('/api/cong-viec/:id/binh-luan', (req, res) => { const t = taskOr404(req, res); if (t) res.json(comments.filter((c) => c.taskId === t.id).map((c) => ({ id: c.id, parentId: c.parentId, content: c.content, author: ref(c.by), createdAt: iso(c.at), updatedAt: null, files: [] }))); });
app.get('/api/cong-viec/:id/lich-su', (req, res) => { const t = taskOr404(req, res); if (t) res.json(history.filter((h) => h.taskId === t.id).sort((a, b) => b.at - a.at).map((h) => ({ ...h, by: ref(h.by), at: iso(h.at) }))); });
app.post('/api/cong-viec', (req, res) => {
  const b = req.body, errors = {};
  if (!b.title) errors.title = 'Chưa nhập tiêu đề công việc.';
  if (!b.draft && !b.categoryId) errors.categoryId = 'Chưa chọn thể loại công việc.';
  if (Object.keys(errors).length) return err(res, 400, 'Vui lòng kiểm tra.', errors);
  const t = { id: ++seq, title: b.title, description: b.description, criteria: b.criteria, categoryId: b.categoryId, priority: b.priority, start: b.start ? new Date(b.start) : null, due: b.due ? new Date(b.due + 'T16:59:59Z') : null, status: b.draft ? 0 : 1, progress: 0, createdAt: new Date(), completedAt: null, unitId: b.unitId, creatorId: req.uid, parentId: b.parentId, templateId: b.templateId, dependsOn: [] };
  tasks.push(t); history.push({ id: ++seq, taskId: t.id, type: 'TaoCongViec', description: 'Tạo công việc', field: null, oldValue: null, newValue: null, by: req.uid, at: new Date() });
  res.status(201).json({ id: t.id });
});
app.put('/api/cong-viec/:id', (req, res) => { const t = taskOr404(req, res); if (!t) return; Object.assign(t, { title: req.body.title, description: req.body.description, criteria: req.body.criteria, priority: req.body.priority }); res.json({ id: t.id }); });
app.post('/api/cong-viec/:id/trang-thai', (req, res) => {
  const t = taskOr404(req, res); if (!t) return;
  const a = req.body.action;
  if (a === 'cancel' && !req.body.note) return err(res, 400, 'x', { note: 'Nhập lý do hủy công việc.' });
  t.status = { publish: 1, pause: 5, resume: 2, cancel: 6, complete: 4 }[a]; res.json({ id: t.id });
});
app.post('/api/cong-viec/:id/phan-cong', (req, res) => {
  const t = taskOr404(req, res); if (!t) return;
  const b = req.body, due = b.due ? new Date(b.due + 'T16:59:59Z') : t.due;
  if (b.kind === 'person' && !b.personIds?.length) return err(res, 400, 'x', { personIds: 'Chọn ít nhất một người nhận.' });
  const targets = b.kind === 'person' ? b.personIds.map((p) => [p, null]) : [[null, b.unitId]];
  for (const [p, u] of targets) { assignments.push({ id: ++seq, taskId: t.id, giver: req.uid, giverUnit: t.unitId, personId: p, unitId: u, note: b.note, status: 0, assignedAt: new Date(), due, acceptedAt: null, completedAt: null, role: b.role }); if (p) notify(p, t.id, 'GiaoViec', `Việc mới: ${t.title}`, 'Bạn được giao việc'); }
  res.json({ created: targets.length });
});
app.post('/api/cong-viec/:id/binh-luan', (req, res) => { const t = taskOr404(req, res); if (!t) return; comments.push({ id: ++seq, taskId: t.id, parentId: req.body.parentId, by: req.uid, content: req.body.content, at: new Date() }); res.json({ id: seq }); });
const aOr404 = (req, res) => { const a = assignments.find((x) => x.id === Number(req.params.id)); if (!a) { err(res, 404, 'Không tìm thấy phân công.'); return null; } return a; };
app.post('/api/phan-cong/:id/tiep-nhan', (req, res) => { const a = aOr404(req, res); if (!a) return; if (!isAssignee(req.r, a)) return err(res, 403, 'Chỉ người nhận việc được tiếp nhận.'); a.status = 1; a.acceptedAt = new Date(); sync(tasks.find((t) => t.id === a.taskId)); res.json({ id: a.id }); });
app.post('/api/phan-cong/:id/tu-choi', (req, res) => { const a = aOr404(req, res); if (!a) return; a.status = 5; res.json({ id: a.id }); });
app.post('/api/phan-cong/:id/huy', (req, res) => { const a = aOr404(req, res); if (!a) return; a.status = 6; res.json({ id: a.id }); });
app.post('/api/phan-cong/:id/nhac', (req, res) => res.json({ notified: 1 }));
app.post('/api/phan-cong/:id/tien-do', (req, res) => {
  const a = aOr404(req, res); if (!a) return;
  if (!req.body.note) return err(res, 400, 'x', { note: 'Ghi lại đã làm được gì trong lần cập nhật này.' });
  progress.push({ id: ++seq, aid: a.id, by: req.uid, percent: req.body.percent, note: req.body.note, at: new Date() }); a.status = 2;
  const t = tasks.find((x) => x.id === a.taskId); t.progress = req.body.percent; sync(t); res.json({ id: a.id });
});
app.post('/api/phan-cong/:id/phan-cong-lai', (req, res) => {
  const a = aOr404(req, res); if (!a) return;
  for (const m of req.body.members) assignments.push({ id: ++seq, taskId: a.taskId, giver: req.uid, giverUnit: a.unitId, personId: m.personId, unitId: null, note: req.body.note, status: 0, assignedAt: new Date(), due: a.due, acceptedAt: null, completedAt: null, role: m.role });
  a.status = 2; res.json({ created: req.body.members.length });
});
app.post('/api/phan-cong/:id/ket-qua', upload.array('files'), (req, res) => {
  const a = aOr404(req, res); if (!a) return;
  if (!req.body.content) return err(res, 400, 'x', { content: 'Mô tả kết quả đã làm được.' });
  results.push({ id: ++seq, aid: a.id, by: req.uid, attempt: results.filter((x) => x.aid === a.id).length + 1, content: req.body.content, status: 0, at: new Date(), review: null });
  a.status = 3; sync(tasks.find((t) => t.id === a.taskId)); res.json({ id: seq });
});
app.post('/api/phan-cong/:id/gia-han', (req, res) => {
  const a = aOr404(req, res); if (!a) return;
  extensions.push({ id: ++seq, aid: a.id, by: req.uid, oldDue: a.due, proposedDue: new Date(req.body.proposedDue + 'T16:59:59Z'), reason: req.body.reason, status: 0, approvedDue: null, comment: '', decidedBy: null, createdAt: new Date(), decidedAt: null });
  res.json({ id: seq });
});
app.post('/api/ket-qua/:id/danh-gia', (req, res) => {
  const r = results.find((x) => x.id === Number(req.params.id)), a = assignments.find((x) => x.id === r.aid);
  r.status = req.body.decision; r.review = { decision: req.body.decision, comment: req.body.comment, by: req.uid, at: new Date() };
  a.status = req.body.decision === 1 ? 4 : 2; sync(tasks.find((t) => t.id === a.taskId)); res.json({ id: r.id });
});
app.post('/api/gia-han/:id/duyet', (req, res) => {
  const x = extensions.find((e) => e.id === Number(req.params.id)), a = assignments.find((y) => y.id === x.aid);
  x.status = { approve: 1, 'approve-other': 2, reject: 3 }[req.body.decision]; x.decidedBy = req.uid; x.decidedAt = new Date(); x.comment = req.body.comment;
  if (x.status !== 3) { a.due = req.body.decision === 'approve' ? x.proposedDue : new Date(req.body.approvedDue + 'T16:59:59Z'); x.approvedDue = a.due; }
  res.json({ id: x.id });
});

// ---------------- Danh mục, thông báo, thống kê, quản trị ----------------
app.get('/api/the-loai', (req, res) => res.json(categories.map((c) => ({ ...c, taskCount: tasks.filter((t) => t.categoryId === c.id).length }))));
app.post('/api/the-loai', (req, res) => { const c = { id: ++seq, name: req.body.name, description: req.body.description, active: req.body.active }; categories.push(c); res.json({ ...c, taskCount: 0 }); });
app.put('/api/the-loai/:id', (req, res) => { const c = categories.find((x) => x.id === Number(req.params.id)); Object.assign(c, req.body); res.json({ ...c, taskCount: 0 }); });
const tplDto = (t) => ({ ...t, categoryName: categories.find((c) => c.id === t.categoryId)?.name ?? '', unitName: unitOf(t.unitId).name, creator: ref(t.creatorId), canEdit: true });
app.get('/api/mau-cong-viec', (req, res) => res.json(templates.map(tplDto)));
app.post('/api/mau-cong-viec', (req, res) => { const t = { id: ++seq, ...req.body, timesUsed: 0, creatorId: req.uid }; templates.push(t); res.json(tplDto(t)); });
app.put('/api/mau-cong-viec/:id', (req, res) => { const t = templates.find((x) => x.id === Number(req.params.id)); Object.assign(t, req.body); res.json(tplDto(t)); });
app.delete('/api/mau-cong-viec/:id', (req, res) => { const i = templates.findIndex((x) => x.id === Number(req.params.id)); if (i < 0) return res.status(404).json({ message: 'Không tìm thấy mẫu.' }); templates.splice(i, 1); res.json({ unlinkedTasks: 0 }); });
app.get('/api/thong-bao', (req, res) => {
  const mine = notifications.filter((n) => n.to === req.uid).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ items: mine.slice(0, Number(req.query.limit) || 30).map(({ to, ...n }) => ({ ...n, createdAt: iso(n.createdAt) })), unread: mine.filter((n) => !n.read).length });
});
app.post('/api/thong-bao/da-doc-tat-ca', (req, res) => { notifications.filter((n) => n.to === req.uid).forEach((n) => (n.read = true)); res.json({ updated: 1 }); });
app.post('/api/thong-bao/:id/da-doc', (req, res) => { const n = notifications.find((x) => x.id === Number(req.params.id) && x.to === req.uid); if (n) n.read = true; res.json({ updated: n ? 1 : 0 }); });
app.get('/api/canh-bao-han', (req, res) => {
  const items = [], n = now();
  for (const a of assignments.filter((x) => isAssignee(req.r, x) && open(x))) {
    const t = tasks.find((x) => x.id === a.taskId);
    if (!running(t) || a.due - n > 3 * DAY) continue;
    items.push({ taskId: t.id, assignmentId: a.id, title: t.title, unitName: unitOf(t.unitId).name, due: iso(a.due), progress: t.progress, overdue: a.due < n, relation: 'assignee' });
  }
  res.json({ overdue: items.filter((x) => x.overdue), dueSoon: items.filter((x) => !x.overdue) });
});
const monthsTo = (to) => { const d = new Date(to); return [5, 4, 3, 2, 1, 0].map((i) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); return { month: x.toISOString().slice(0, 7), assigned: (i * 2) % 5, completed: i % 3 }; }); };
app.get('/api/thong-ke/don-vi', (req, res) => {
  if (!req.r.admin && !req.r.view.size) return err(res, 403, 'Chức vụ của bạn chưa có quyền xem thống kê đơn vị.');
  const list = tasks.filter((t) => t.status !== 0 && t.status !== 6);
  res.json({ from: req.query.from, to: req.query.to, scopeLabel: 'Khoa Công nghệ Thông tin, gồm đơn vị trực thuộc', total: list.length, open: list.filter((t) => t.status !== 4).length, completed: list.filter((t) => t.status === 4).length, onTimePercent: 100, onTimeCount: 1, overdue: 1, passed: 1, needsWork: 0, failed: 0,
    byStatus: [{ key: 'done', label: 'Hoàn thành', value: 1 }, { key: 'doing', label: 'Đang thực hiện', value: 2 }, { key: 'review', label: 'Chờ duyệt', value: 1 }, { key: 'new', label: 'Chưa bắt đầu', value: 1 }, { key: 'paused', label: 'Tạm dừng', value: 0 }],
    byMonth: monthsTo(req.query.to), byUnit: units.slice(1, 3).map((u) => ({ unitId: u.id, unitName: u.name, total: 3, open: 2, completed: 1, overdue: 0, onTimePercent: 100 })),
    byPerson: [{ personId: 4, name: nameOf(4), initials: initials(nameOf(4)), unitName: 'Bộ môn Khoa học dữ liệu', assigned: 4, completed: 1, onTimePercent: 100, overdue: 1, passed: 1 }] });
});
app.get('/api/thong-ke/ca-nhan', (req, res) => {
  const pid = Number(req.query.personId) || req.uid, n = now();
  const mine = assignments.filter((a) => a.personId === pid && a.status < 5);
  const ms = memberships.filter((m) => m.personId === pid);
  res.json({
    from: req.query.from, to: req.query.to, person: ref(pid), subtitle: 'Giảng viên · Bộ môn Khoa học dữ liệu',
    assigned: mine.length, lead: mine.filter((a) => a.role === 1).length, support: mine.filter((a) => a.role === 2).length, completed: mine.filter((a) => a.status === 4).length,
    onTimePercent: 88, onTimeCount: 1, open: mine.filter((a) => a.status <= 3).length, dueSoon: mine.filter((a) => open(a) && a.due >= n && a.due - n <= 3 * DAY).length,
    waitingReview: mine.filter((a) => a.status === 3).length, passed: 7, needsWork: 1, extensions: 1, unitAverageOnTime: 82, byMonth: monthsTo(req.query.to),
    byCategory: [{ key: 'Đào tạo', label: 'Đào tạo', value: 2 }], asAssigner: rights(pid).assign.size ? { assigned: 3, pendingTotal: 1, pendingResults: 1, pendingExtensions: 0, pendingAccept: 0, averageReviewDays: 1.5, late: 0, pending: [{ kind: 'result', taskId: 104, title: 'Tổ chức hội thảo', who: nameOf(4), since: iso(days(-1)), waitingDays: 1 }] } : null,
    memberships: ms.map((m) => ({ unitId: m.unitId, unitName: unitOf(m.unitId).name, unitType: unitOf(m.unitId).type, role: roles.find((r) => r.id === m.roleId).name, start: m.start, end: m.end || null, primary: m.primary, ended: false, openTasks: mine.filter((a) => open(a)).length })),
    overdue: mine.filter((a) => open(a) && a.due < n).length, failed: 0, approvedExtensions: 1, unitName: 'Bộ môn Khoa học dữ liệu',
  });
});
app.get('/api/nhat-ky', (req, res) => (req.r.admin ? res.json(audit.map((a) => ({ ...a, at: iso(a.at) }))) : err(res, 403, 'Chỉ quản trị hệ thống xem được nhật ký.')));
app.use('/api', (req, res) => err(res, 404, 'Không tìm thấy đường dẫn API.'));
app.use(express.static(path.resolve(root, '../apps/web/dist')));

const port = Number(process.env.PORT || 5199);
app.listen(port, () => console.log(`Mock API http://localhost:${port}`));
