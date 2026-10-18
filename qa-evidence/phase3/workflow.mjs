// Phase 3 — kiểm thử luồng GHI đầu-cuối. CHỈ chạy trên API trỏ vào BẢN SAO CSDL (QLCongViecKhoaCNTT_QA, cổng 5090).
// Tự từ chối chạy với cổng 5080 (CSDL thật).
// Chạy: node qa-evidence/phase3/workflow.mjs http://localhost:5090
const BASE = (process.argv[2] || 'http://localhost:5090').replace(/\/$/, '');
if (/:5080\b/.test(BASE)) { console.error('Từ chối: 5080 là CSDL thật.'); process.exit(2); }
const PASS = process.env.SMOKE_PASSWORD || 'Demo@CNTT2026!';
const results = [];
const check = (id, name, ok, evidence) => { results.push({ id, name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} — ${evidence}`); };
const step = async (id, name, fn) => { try { await fn(); } catch (e) { check(id, name, false, 'ngoại lệ: ' + e.message); } };

async function call(cookie, method, path, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + path, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  let data = null; const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res, setCookie: res.headers.getSetCookie?.() ?? [] };
}
const jar = (r) => r.setCookie.map((c) => c.split(';')[0]).join('; ');
async function login(email, password = PASS) { const r = await call(null, 'POST', '/api/auth/login', { email, password }); return { ...r, cookie: jar(r) }; }
const ok2 = (s) => s >= 200 && s < 300;
const ymd = (days) => new Date(Date.now() + 7 * 3600e3 + days * 864e5).toISOString().slice(0, 10);
const TAG = `[THỬ-P3 ${Date.now().toString(36)}]`;

const dean = (await login('vunh@huit.edu.vn')).cookie;
const hand = (await login('hand@huit.edu.vn')).cookie;
const trang = (await login('trangntt@huit.edu.vn')).cookie;
const admin = (await login('admin.demo@example.invalid')).cookie;
const bao = (await login('baopt@huit.edu.vn')).cookie;
console.log(`Bản sao: ${BASE}  nhãn dữ liệu thử: ${TAG}\n`);

// ---------- A. Xác thực ----------
await step('AUTH-01', 'Phiên: me / refresh / logout', async () => {
  const s = await login('hand@huit.edu.vn');
  const me = await call(s.cookie, 'GET', '/api/auth/me');
  const rt = s.setCookie.find((c) => c.startsWith('khoa_rt='));
  const ref = await call(rt.split(';')[0], 'POST', '/api/auth/refresh');
  const out = await call(s.cookie, 'POST', '/api/auth/logout');
  const reuse = await call(rt.split(';')[0], 'POST', '/api/auth/refresh');
  const cleared = out.setCookie.some((c) => /^khoa_at=;/.test(c) || /khoa_at=.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i.test(c));
  check('AUTH-01', 'me 200, refresh 200, logout 204 và xóa cookie phiên', me.status === 200 && ref.status === 200 && ok2(out.status) && cleared,
    `me=${me.status} refresh=${ref.status} logout=${out.status} xóa-cookie=${cleared}`);
  check('NEW-P3-01', 'Refresh token đã lấy trước khi đăng xuất bị máy chủ từ chối sau đăng xuất', reuse.status === 401, `refresh-sau-logout=${reuse.status}`);
  check('AUTH-02', 'Cookie httpOnly + SameSite=Strict', s.setCookie.every((c) => /HttpOnly/i.test(c) && /SameSite=Strict/i.test(c)), s.setCookie.map((c) => c.split(';').slice(1).join(';')).join(' || '));
});
await step('AUTH-03', 'Sai mật khẩu', async () => {
  const r = await login('hand@huit.edu.vn', 'sai-mat-khau');
  check('AUTH-03', 'Sai mật khẩu → 401, không đặt cookie', r.status === 401 && !r.cookie, `status=${r.status} cookie=${r.cookie ? 'có' : 'không'}`);
});

// ---------- B. Nhân sự (CRUD) + đổi mật khẩu ----------
let staffId, staffEmail = `thu.p3.${Date.now().toString(36)}@example.invalid`, tempPass;
await step('STAFF-01', 'Thêm nhân sự', async () => {
  const r = await call(admin, 'POST', '/api/nhan-su', { name: `${TAG} Nguyễn Văn Thử`, email: staffEmail, phone: '0900000000', isSystemAdmin: false, active: true });
  staffId = r.data?.id ?? r.data?.person?.id; tempPass = r.data?.temporaryPassword ?? r.data?.password ?? r.data?.tempPassword;
  check('STAFF-01', 'Quản trị thêm nhân sự → 2xx, trả mật khẩu tạm', ok2(r.status) && !!staffId && !!tempPass, `status=${r.status} keys=${Object.keys(r.data ?? {}).join(',')}`);
});
await step('STAFF-02', 'Trùng email', async () => {
  const r = await call(admin, 'POST', '/api/nhan-su', { name: 'Trùng Email', email: staffEmail.toUpperCase(), isSystemAdmin: false, active: true });
  check('STAFF-02', 'Email trùng (khác hoa/thường) → 400/409 có lỗi trường email', (r.status === 400 || r.status === 409) && JSON.stringify(r.data).includes('email'), `status=${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
});
await step('STAFF-03', 'Sửa nhân sự + lưu CSDL', async () => {
  const r = await call(admin, 'PUT', `/api/nhan-su/${staffId}`, { name: `${TAG} Nguyễn Văn Đã Sửa`, email: staffEmail, phone: '0911111111', isSystemAdmin: false, active: true });
  const g = await call(admin, 'GET', `/api/nhan-su/${staffId}`);
  const s = JSON.stringify(g.data);
  check('STAFF-03', 'Sửa → 2xx; đọc lại thấy tên/SĐT mới', ok2(r.status) && s.includes('Đã Sửa') && s.includes('0911111111'), `put=${r.status} get=${g.status}`);
});
await step('STAFF-04', 'Giảng viên không thêm được nhân sự', async () => {
  const r = await call(hand, 'POST', '/api/nhan-su', { name: 'Không Được', email: 'x.' + staffEmail, isSystemAdmin: false, active: true });
  check('STAFF-04', 'Giảng viên POST /api/nhan-su → 403', r.status === 403, `status=${r.status}`);
});
await step('PWD-01', 'Đổi mật khẩu bằng mật khẩu tạm', async () => {
  const s = await login(staffEmail, tempPass);
  const NEW = 'Thu@P3-' + Date.now().toString(36) + 'Xy';
  const wrong = await call(s.cookie, 'POST', '/api/auth/doi-mat-khau', { currentPassword: 'sai', newPassword: NEW, confirmPassword: NEW });
  const weak = await call(s.cookie, 'POST', '/api/auth/doi-mat-khau', { currentPassword: tempPass, newPassword: '123', confirmPassword: '123' });
  const good = await call(s.cookie, 'POST', '/api/auth/doi-mat-khau', { currentPassword: tempPass, newPassword: NEW, confirmPassword: NEW });
  const oldLogin = await login(staffEmail, tempPass);
  const newLogin = await login(staffEmail, NEW);
  check('PWD-01', 'Đăng nhập mật khẩu tạm 200; sai hiện tại 400/401; mk yếu 400; đổi đúng 2xx; mk cũ 401; mk mới 200',
    s.status === 200 && [400, 401].includes(wrong.status) && weak.status === 400 && ok2(good.status) && oldLogin.status === 401 && newLogin.status === 200,
    `login-tạm=${s.status} sai=${wrong.status} yếu=${weak.status} đổi=${good.status} mk-cũ=${oldLogin.status} mk-mới=${newLogin.status} ${good.status >= 300 ? JSON.stringify(good.data).slice(0, 200) : ''}`);
});
await step('STAFF-05', 'Khóa tài khoản', async () => {
  const r = await call(admin, 'PUT', `/api/nhan-su/${staffId}/trang-thai`, { active: false });
  const l = await login(staffEmail, 'bat-ky');
  const reset = await call(admin, 'POST', `/api/nhan-su/${staffId}/cap-lai-mat-khau`);
  const temp2 = reset.data?.temporaryPassword ?? reset.data?.password;
  const lockedLogin = temp2 ? await login(staffEmail, temp2) : { status: 'n/a' };
  check('STAFF-05', 'Khóa → 2xx; cấp lại mk 2xx; tài khoản khóa đăng nhập bằng mk đúng vẫn bị từ chối', ok2(r.status) && ok2(reset.status) && [401, 403].includes(lockedLogin.status),
    `khóa=${r.status} cấp-lại=${reset.status} login-khi-khóa=${lockedLogin.status} (thử sai=${l.status})`);
});

// ---------- C. Tổ chức ----------
let unitId;
await step('ORG-01', 'Quy tắc một khoa', async () => {
  const r = await call(admin, 'POST', '/api/don-vi', { name: `${TAG} Khoa khác`, type: 'Khoa', active: true, parentId: null });
  check('ORG-01', 'Tạo đơn vị loại "Khoa" thứ hai → 400', r.status === 400, `status=${r.status} ${JSON.stringify(r.data?.errors ?? r.data).slice(0, 160)}`);
});
await step('ORG-02', 'Tạo bộ môn dưới khoa', async () => {
  const r = await call(admin, 'POST', '/api/don-vi', { name: `${TAG} Nhóm thử`, type: 'Nhóm', active: true, parentId: 1 });
  unitId = r.data?.unit?.id;
  check('ORG-02', 'Tạo đơn vị con → 2xx; đọc lại có trong /api/don-vi', ok2(r.status) && !!unitId && JSON.stringify((await call(admin, 'GET', '/api/don-vi')).data).includes('Nhóm thử'), `status=${r.status} id=${unitId}`);
});
await step('ORG-03', 'Thêm thành viên', async () => {
  const roles = (await call(admin, 'GET', '/api/chuc-vu')).data;
  const role = (Array.isArray(roles) ? roles : roles?.items ?? []).find((x) => /Giảng viên/i.test(x.name)) ?? (Array.isArray(roles) ? roles[0] : null);
  await call(admin, 'PUT', `/api/nhan-su/${staffId}/trang-thai`, { active: true });
  const r = await call(admin, 'POST', '/api/thanh-vien', { personId: staffId, unitId, roleId: role?.id, start: ymd(0), primary: true });
  const dup = await call(admin, 'POST', '/api/thanh-vien', { personId: staffId, unitId, roleId: role?.id, start: ymd(0), primary: true });
  check('ORG-03', 'Thêm thành viên → 2xx; thêm trùng → 4xx', ok2(r.status) && dup.status >= 400 && dup.status < 500, `them=${r.status} trung=${dup.status} role=${role?.name} ${ok2(r.status) ? '' : JSON.stringify(r.data).slice(0, 200)}`);
  const bad = await call(hand, 'POST', '/api/thanh-vien', { personId: staffId, unitId, roleId: role?.id, start: ymd(0), primary: false });
  check('ORG-04', 'Giảng viên thêm thành viên → 403', bad.status === 403, `status=${bad.status}`);
});

// ---------- D. Danh mục ----------
await step('CAT-01', 'Thể loại + mẫu công việc CRUD', async () => {
  const c = await call(admin, 'POST', '/api/the-loai', { name: `${TAG} Thể loại`, description: 'thử', active: true });
  const u = await call(admin, 'PUT', `/api/the-loai/${c.data?.id}`, { name: `${TAG} Thể loại sửa`, description: 'thử 2', active: false });
  check('CAT-01', 'Thêm thể loại 2xx, sửa (ngừng) 2xx, đọc lại đã ngừng', ok2(c.status) && ok2(u.status) && u.data?.active === false, `them=${c.status} sua=${u.status} active=${u.data?.active}`);
  const t = await call(dean, 'POST', '/api/mau-cong-viec', { name: `${TAG} Mẫu`, title: `${TAG} Tiêu đề mẫu`, unitId: 1, categoryId: 1, priority: 2, durationDays: 7, recurrence: 0, active: true });
  const tu = await call(dean, 'PUT', `/api/mau-cong-viec/${t.data?.id}`, { name: `${TAG} Mẫu sửa`, title: `${TAG} Tiêu đề mẫu`, unitId: 1, categoryId: 1, priority: 3, durationDays: 5, recurrence: 0, active: true });
  const td = await call(dean, 'DELETE', `/api/mau-cong-viec/${t.data?.id}`);
  const after = JSON.stringify((await call(dean, 'GET', '/api/mau-cong-viec')).data);
  check('CAT-02', 'Mẫu: thêm 2xx, sửa 2xx, xóa 2xx, không còn trong danh sách', ok2(t.status) && ok2(tu.status) && ok2(td.status) && !after.includes(`${TAG} Mẫu`), `them=${t.status} sua=${tu.status} xoa=${td.status} ${ok2(t.status) ? '' : JSON.stringify(t.data).slice(0, 200)}`);
  const hc = await call(hand, 'POST', '/api/the-loai', { name: 'GV thêm', active: true });
  check('CAT-03', 'Giảng viên thêm thể loại → 403', hc.status === 403, `status=${hc.status}`);
});

// ---------- E. Công việc: kiểm dữ liệu ----------
await step('VAL-01', 'Kiểm dữ liệu tạo công việc', async () => {
  const past = await call(dean, 'POST', '/api/cong-viec', { title: `${TAG} quá hạn`, categoryId: 1, unitId: 1, due: ymd(-2), priority: 2 });
  const empty = await call(dean, 'POST', '/api/cong-viec', { title: '   ', categoryId: 1, unitId: 1, due: ymd(5) });
  const order = await call(dean, 'POST', '/api/cong-viec', { title: `${TAG} ngược`, categoryId: 1, unitId: 1, start: ymd(10), due: ymd(5) });
  const badDate = await call(dean, 'POST', '/api/cong-viec', { title: `${TAG} ngày sai`, categoryId: 1, unitId: 1, due: '2026-02-30' });
  const longT = await call(dean, 'POST', '/api/cong-viec', { title: 'x'.repeat(251), categoryId: 1, unitId: 1, due: ymd(5) });
  const pr = await call(dean, 'POST', '/api/cong-viec', { title: `${TAG} ưu tiên`, categoryId: 1, unitId: 1, due: ymd(5), priority: 9 });
  check('VAL-01', 'Hạn đã qua / tiêu đề rỗng / hạn trước ngày bắt đầu / ngày 30-02 / tiêu đề 251 ký tự / ưu tiên 9 → 400 đúng trường',
    past.data?.errors?.due && empty.data?.errors?.title && order.data?.errors?.due && badDate.data?.errors?.due && longT.data?.errors?.title && pr.data?.errors?.priority && [past, empty, order, badDate, longT, pr].every((x) => x.status === 400),
    [past, empty, order, badDate, longT, pr].map((x) => `${x.status}:${Object.keys(x.data?.errors ?? {}).join('+')}`).join(' '));
  const gv = await call(hand, 'POST', '/api/cong-viec', { title: `${TAG} gv ở khoa`, categoryId: 1, unitId: 1, due: ymd(5) });
  check('VAL-02', 'Giảng viên tạo việc cho đơn vị Khoa (ngoài quyền) → 400 lỗi unitId hoặc 403', gv.status === 403 || (gv.status === 400 && gv.data?.errors?.unitId), `status=${gv.status} ${JSON.stringify(gv.data?.errors ?? '')}`);
});

// ---------- F. Luồng nghiệp vụ chính ----------
let taskId, asHand, asTrang;
const detail = async (c) => (await call(c, 'GET', `/api/cong-viec/${taskId}`)).data;
await step('FLOW-01', 'Tạo công việc', async () => {
  const r = await call(dean, 'POST', '/api/cong-viec', { title: `${TAG} Biên soạn đề cương`, description: 'Kiểm thử Phase 3', criteria: 'Có đề cương', categoryId: 1, unitId: 1, priority: 3, start: ymd(0), due: ymd(14) });
  taskId = r.data?.id;
  const d = taskId ? await detail(dean) : null;
  check('FLOW-01', 'Trưởng khoa tạo việc → 2xx, đọc lại đúng tiêu đề/ưu tiên', ok2(r.status) && d?.summary?.title === `${TAG} Biên soạn đề cương` && d?.summary?.priority === 3, `status=${r.status} id=${taskId}`);
});
await step('FLOW-02', 'Giao việc', async () => {
  const before = (await call(hand, 'GET', `/api/cong-viec/${taskId}`)).status;
  const a1 = await call(dean, 'POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: [3], role: 1, note: 'Chủ trì' });
  const a2 = await call(dean, 'POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: [8], role: 2, note: 'Phối hợp' });
  const dup = await call(dean, 'POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: [3], role: 2 });
  const late = await call(dean, 'POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: [26], due: ymd(30) });
  const byGv = await call(hand, 'POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: [26] });
  const d = await detail(dean);
  asHand = d.assignments.find((a) => a.personId === 3); asTrang = d.assignments.find((a) => a.personId === 8);
  const after = (await call(hand, 'GET', `/api/cong-viec/${taskId}`)).status;
  check('FLOW-02', 'Giao chủ trì + phối hợp 2xx; giao trùng 400; hạn riêng muộn hơn hạn chung 400; người được giao mới xem được việc',
    ok2(a1.status) && ok2(a2.status) && dup.status === 400 && late.status === 400 && !!asHand && !!asTrang && before !== 200 && after === 200,
    `giao=${a1.status},${a2.status} trùng=${dup.status} hạn-muộn=${late.status} xem-trước=${before} xem-sau=${after}`);
  check('AUTHZ-01', 'Giảng viên giao việc trên công việc của khoa → 403', byGv.status === 403, `status=${byGv.status}`);
  const notes = (await call(hand, 'GET', '/api/thong-bao?unread=1')).data;
  check('NOTI-01', 'Người nhận có thông báo về việc mới', notes.items.some((n) => n.taskId === taskId), `số thông báo chưa đọc=${notes.unread}`);
});
await step('FLOW-03', 'Tiếp nhận + tiến độ', async () => {
  const pre = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/tien-do`, { percent: 10, note: 'trước khi nhận' });
  const other = await call(trang, 'POST', `/api/phan-cong/${asHand.id}/tiep-nhan`);
  const acc = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/tiep-nhan`);
  const again = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/tiep-nhan`);
  const noNote = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/tien-do`, { percent: 50, note: '' });
  const over = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/tien-do`, { percent: 150, note: 'x' });
  const p = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/tien-do`, { percent: 50, note: 'Xong chương 1–3' });
  const a = (await detail(hand)).assignments.find((x) => x.id === asHand.id);
  check('FLOW-03', 'Nhận việc 2xx; nhận lại 409; tiến độ thiếu ghi chú/150% → 400; 50% lưu và có trong lịch sử tiến độ',
    ok2(acc.status) && again.status === 409 && noNote.status === 400 && over.status === 400 && ok2(p.status) && Math.round(a.progress) === 50 && a.progressHistory[0]?.note === 'Xong chương 1–3',
    `nhận=${acc.status} nhận-lại=${again.status} thiếu-ghi-chú=${noNote.status} 150%=${over.status} lưu=${p.status} progress=${a.progress}`);
  check('AUTHZ-02', 'Người khác nhận hộ phân công → 403; cập nhật tiến độ trước khi nhận → 4xx', other.status === 403 && pre.status >= 400 && pre.status < 500, `nhận-hộ=${other.status} trước-khi-nhận=${pre.status}`);
});
await step('FLOW-04', 'Bình luận có tệp', async () => {
  const fd = new FormData(); fd.append('content', `${TAG} bình luận`); fd.append('files', new Blob(['noi dung thu'], { type: 'text/plain' }), 'ghi-chu.txt');
  const r = await call(hand, 'POST', `/api/cong-viec/${taskId}/binh-luan`, fd);
  const list = (await call(dean, 'GET', `/api/cong-viec/${taskId}/binh-luan`)).data;
  const cm = list.find((x) => x.content === `${TAG} bình luận`);
  const f = cm?.files?.[0];
  const dl = f ? await fetch(`${BASE}/api/tep/${f.id}`, { headers: { Cookie: dean } }) : null;
  const body = dl ? await dl.text() : '';
  const outsider = f ? (await call(bao, 'GET', `/api/tep/${f.id}`)).status : 'n/a';
  check('FLOW-04', 'Bình luận + tệp 2xx; người giao đọc được; tải tệp đúng nội dung', ok2(r.status) && !!cm && body === 'noi dung thu', `status=${r.status} tệp=${f?.name} tải=${dl?.status} disposition=${dl?.headers.get('content-disposition')}`);
  check('AUTHZ-03', 'Người ngoài công việc tải tệp → 403/404', outsider === 403 || outsider === 404, `status=${outsider}`);
  const empty = await call(hand, 'POST', `/api/cong-viec/${taskId}/binh-luan`, (() => { const x = new FormData(); x.append('content', '  '); return x; })());
  check('VAL-03', 'Bình luận rỗng không tệp → 400', empty.status === 400, `status=${empty.status}`);
});
await step('FLOW-05', 'Gia hạn', async () => {
  const bad = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/gia-han`, { reason: 'x', proposedDue: ymd(-1) });
  const r = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/gia-han`, { reason: 'Cần thêm thời gian khảo sát', proposedDue: ymd(21) });
  const dup = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/gia-han`, { reason: 'lần 2', proposedDue: ymd(22) });
  const extId = (await detail(dean)).assignments.find((x) => x.id === asHand.id).extensions.find((e) => e.status === 0)?.id;
  const selfApprove = await call(hand, 'POST', `/api/gia-han/${extId}/duyet`, { decision: 'approve' });
  const ap = await call(dean, 'POST', `/api/gia-han/${extId}/duyet`, { decision: 'approve', comment: 'Đồng ý' });
  const twice = await call(dean, 'POST', `/api/gia-han/${extId}/duyet`, { decision: 'approve' });
  const a = (await detail(dean)).assignments.find((x) => x.id === asHand.id);
  check('FLOW-05', 'Hạn đề xuất đã qua → 400; xin gia hạn 2xx; xin trùng 4xx; trưởng khoa duyệt 2xx; duyệt lại 409; hạn phân công đổi sang ngày mới',
    bad.status === 400 && ok2(r.status) && dup.status >= 400 && ok2(ap.status) && twice.status === 409 && a.due.slice(0, 10) >= ymd(20),
    `hạn-qua=${bad.status} xin=${r.status} trùng=${dup.status} duyệt=${ap.status} duyệt-lại=${twice.status} hạn-mới=${a.due}`);
  check('AUTHZ-04', 'Người xin tự duyệt gia hạn → 403', selfApprove.status === 403, `status=${selfApprove.status}`);
});
await step('FLOW-06', 'Nộp kết quả → cần bổ sung → nộp lại → đạt', async () => {
  const empty = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/ket-qua`, (() => { const x = new FormData(); x.append('content', ''); return x; })());
  const byOther = await call(trang, 'POST', `/api/phan-cong/${asHand.id}/ket-qua`, (() => { const x = new FormData(); x.append('content', 'nộp hộ'); return x; })());
  const fd = new FormData(); fd.append('content', 'Đề cương bản 1'); fd.append('link', 'https://example.invalid/de-cuong'); fd.append('files', new Blob(['%PDF-1.4 thu'], { type: 'application/pdf' }), 'de-cuong.pdf');
  const s1 = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/ket-qua`, fd);
  const dupSubmit = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/ket-qua`, (() => { const x = new FormData(); x.append('content', 'nộp tiếp khi đang chờ duyệt'); return x; })());
  let a = (await detail(dean)).assignments.find((x) => x.id === asHand.id);
  const r1 = a.results[0];
  const selfEval = await call(hand, 'POST', `/api/ket-qua/${r1.id}/danh-gia`, { decision: 1, comment: 'tự duyệt' });
  const noComment = await call(dean, 'POST', `/api/ket-qua/${r1.id}/danh-gia`, { decision: 2, comment: '' });
  const e1 = await call(dean, 'POST', `/api/ket-qua/${r1.id}/danh-gia`, { decision: 2, comment: 'Bổ sung phần đánh giá' });
  const fd2 = new FormData(); fd2.append('content', 'Đề cương bản 2 (đã bổ sung)');
  const s2 = await call(hand, 'POST', `/api/phan-cong/${asHand.id}/ket-qua`, fd2);
  a = (await detail(dean)).assignments.find((x) => x.id === asHand.id);
  const r2 = a.results[0];
  const e2 = await call(dean, 'POST', `/api/ket-qua/${r2.id}/danh-gia`, { decision: 1, comment: 'Đạt' });
  a = (await detail(dean)).assignments.find((x) => x.id === asHand.id);
  check('FLOW-06', 'Nộp rỗng 400; nộp có tệp 2xx (status chờ duyệt=3); nộp tiếp khi chờ duyệt 409; "cần bổ sung" thiếu nhận xét 400; bổ sung 2xx; nộp lần 2 2xx; đạt → phân công hoàn thành (4)',
    empty.status === 400 && ok2(s1.status) && r1.attempt === 1 && dupSubmit.status === 409 && noComment.status === 400 && ok2(e1.status) && ok2(s2.status) && r2.attempt === 2 && ok2(e2.status) && a.status === 4 && !!a.completedAt,
    `rỗng=${empty.status} nộp1=${s1.status} trùng=${dupSubmit.status} thiếu-NX=${noComment.status} bổ-sung=${e1.status} nộp2=${s2.status} đạt=${e2.status} trạng-thái=${a.status} số-lần=${a.results.length}`);
  check('AUTHZ-05', 'Người khác nộp hộ → 403; người nộp tự đánh giá → 403', byOther.status === 403 && selfEval.status === 403, `nộp-hộ=${byOther.status} tự-đánh-giá=${selfEval.status}`);
});
await step('FLOW-07', 'Xin thôi phân công', async () => {
  await call(trang, 'POST', `/api/phan-cong/${asTrang.id}/tiep-nhan`);
  const noReason = await call(trang, 'POST', `/api/phan-cong/${asTrang.id}/xin-tu-choi`, { reason: '' });
  const r = await call(trang, 'POST', `/api/phan-cong/${asTrang.id}/xin-tu-choi`, { reason: 'Trùng lịch coi thi' });
  const reqId = (await detail(dean)).assignments.find((x) => x.id === asTrang.id).declines.find((x) => x.status === 0)?.id;
  const rejNoComment = await call(dean, 'POST', `/api/xin-tu-choi/${reqId}/duyet`, { decision: 'reject' });
  const ap = await call(dean, 'POST', `/api/xin-tu-choi/${reqId}/duyet`, { decision: 'approve' });
  const a = (await detail(dean)).assignments.find((x) => x.id === asTrang.id);
  check('FLOW-07', 'Thiếu lý do 400; xin thôi 2xx; từ chối không lý do 400; đồng ý 2xx → phân công kết thúc (≥5)', noReason.status === 400 && ok2(r.status) && rejNoComment.status === 400 && ok2(ap.status) && a.status >= 5,
    `thiếu-lý-do=${noReason.status} xin=${r.status} từ-chối-ko-lý-do=${rejNoComment.status} đồng-ý=${ap.status} trạng-thái=${a.status}`);
});
await step('FLOW-08', 'Hoàn thành công việc + lịch sử', async () => {
  const d0 = await detail(dean);
  const c = await call(dean, 'POST', `/api/cong-viec/${taskId}/trang-thai`, { action: 'complete' });
  const d = await detail(dean);
  const hist = (await call(dean, 'GET', `/api/cong-viec/${taskId}/lich-su`)).data;
  const dupName = hist.filter((h) => h.by && h.description.startsWith(h.by.name + ' ' + h.by.name)).length;
  check('FLOW-08', 'Đóng công việc → 2xx, trạng thái Hoàn thành; lịch sử có ghi nhận', (ok2(c.status) || d0.summary.status === 4) && d.summary.status === 4 && hist.length >= 5, `complete=${c.status} ${ok2(c.status) ? '' : JSON.stringify(c.data).slice(0, 160)} trạng-thái=${d.summary.status} lịch-sử=${hist.length} dòng`);
  check('REG-HIST', 'Lịch sử không lặp tên người thao tác ("Tên Tên …")', dupName === 0, `dòng lặp=${dupName}`);
  const edit = await call(dean, 'PUT', `/api/cong-viec/${taskId}`, { title: 'sửa sau khi xong', categoryId: 1, unitId: 1, due: ymd(14) });
  check('FLOW-09', 'Sửa công việc đã hoàn thành → bị từ chối (4xx)', edit.status >= 400 && edit.status < 500, `status=${edit.status}`);
});
await step('FLOW-10', 'Bản nháp → công khai → tạm dừng → tiếp tục → hủy', async () => {
  const dr = await call(dean, 'POST', '/api/cong-viec', { title: `${TAG} Bản nháp`, unitId: 1, draft: true });
  const id = dr.data?.id;
  const asg = await call(dean, 'POST', `/api/cong-viec/${id}/phan-cong`, { kind: 'person', personIds: [3] });
  const pubBad = await call(dean, 'POST', `/api/cong-viec/${id}/trang-thai`, { action: 'publish' });
  const up = await call(dean, 'PUT', `/api/cong-viec/${id}`, { title: `${TAG} Bản nháp`, unitId: 1, categoryId: 2, due: ymd(10), draft: true });
  const pub = await call(dean, 'POST', `/api/cong-viec/${id}/trang-thai`, { action: 'publish' });
  const pause = await call(dean, 'POST', `/api/cong-viec/${id}/trang-thai`, { action: 'pause', note: 'chờ' });
  const asgPaused = await call(dean, 'POST', `/api/cong-viec/${id}/phan-cong`, { kind: 'person', personIds: [3] });
  const resume = await call(dean, 'POST', `/api/cong-viec/${id}/trang-thai`, { action: 'resume' });
  const cancelNo = await call(dean, 'POST', `/api/cong-viec/${id}/trang-thai`, { action: 'cancel' });
  const cancel = await call(dean, 'POST', `/api/cong-viec/${id}/trang-thai`, { action: 'cancel', note: 'Kiểm thử Phase 3' });
  const st = (await call(dean, 'GET', `/api/cong-viec/${id}`)).data.summary.status;
  check('FLOW-10', 'Nháp 2xx; giao trên nháp 409; công khai khi thiếu thể loại/hạn 400; sửa + công khai 2xx; tạm dừng 2xx; giao khi tạm dừng 409; tiếp tục 2xx; hủy thiếu lý do 400; hủy 2xx → trạng thái 6',
    ok2(dr.status) && asg.status === 409 && pubBad.status === 400 && ok2(up.status) && ok2(pub.status) && ok2(pause.status) && asgPaused.status === 409 && ok2(resume.status) && cancelNo.status === 400 && ok2(cancel.status) && st === 6,
    `nháp=${dr.status} giao-nháp=${asg.status} công-khai-thiếu=${pubBad.status} sửa=${up.status} công-khai=${pub.status} dừng=${pause.status} giao-khi-dừng=${asgPaused.status} tiếp=${resume.status} hủy-thiếu=${cancelNo.status} hủy=${cancel.status} status=${st}`);
});
await step('NOTI-02', 'Đánh dấu thông báo', async () => {
  const before = (await call(hand, 'GET', '/api/thong-bao')).data;
  const one = before.items.find((n) => !n.read);
  const r1 = one ? await call(hand, 'POST', `/api/thong-bao/${one.id}/da-doc`) : { status: 'n/a' };
  const foreign = one ? await call(trang, 'POST', `/api/thong-bao/${one.id}/da-doc`) : { status: 'n/a' };
  const all = await call(hand, 'POST', '/api/thong-bao/da-doc-tat-ca');
  const after = (await call(hand, 'GET', '/api/thong-bao')).data;
  check('NOTI-02', 'Đánh dấu 1 thông báo 2xx; đọc tất cả 2xx → unread = 0', ok2(r1.status) && ok2(all.status) && after.unread === 0, `một=${r1.status} tất-cả=${all.status} unread ${before.unread}→${after.unread}`);
  check('AUTHZ-06', 'Đánh dấu thông báo của người khác không có tác dụng (updated=0 hoặc 403/404)', foreign.status === 403 || foreign.status === 404 || foreign.data?.updated === 0, `status=${foreign.status} ${JSON.stringify(foreign.data)}`);
});
await step('STAT-01', 'Thống kê phản ánh việc mới', async () => {
  const s = (await call(dean, 'GET', `/api/thong-ke/ca-nhan?personId=3&period=year`));
  check('STAT-01', 'Thống kê cá nhân của giảng viên được đọc sau luồng ghi (200)', s.status === 200, `status=${s.status} keys=${Object.keys(s.data ?? {}).slice(0, 8).join(',')}`);
});
await step('AUDIT-01', 'Nhật ký hệ thống', async () => {
  const log = (await call(admin, 'GET', '/api/nhat-ky?limit=200')).data;
  check('AUDIT-01', 'Nhật ký có ghi nhận thao tác quản trị (thêm nhân sự / đơn vị / thể loại)', Array.isArray(log) && log.length > 0 && JSON.stringify(log.slice(0, 60)).length > 0, `dòng=${log.length}; 5 hành động mới nhất: ${log.slice(0, 5).map((x) => x.action).join(' | ')}`);
});
await step('STAFF-06', 'Xóa nhân sự', async () => {
  const p2 = await call(admin, 'POST', '/api/nhan-su', { name: `${TAG} Xóa được`, email: `xoa.${staffEmail}`, isSystemAdmin: false, active: true });
  const p2id = p2.data?.person?.id;
  const del = await call(admin, 'DELETE', `/api/nhan-su/${p2id}`);
  const gone = await call(admin, 'GET', `/api/nhan-su/${p2id}`);
  const delUsed = await call(admin, 'DELETE', '/api/nhan-su/3');
  check('STAFF-06', 'Xóa nhân sự mới → 2xx, đọc lại 404; xóa người đã có dữ liệu công việc → bị từ chối (4xx)', ok2(del.status) && gone.status === 404 && delUsed.status >= 400 && delUsed.status < 500,
    `xóa=${del.status} đọc-lại=${gone.status} xóa-người-có-dữ-liệu=${delUsed.status}`);
});

console.log(JSON.stringify({ taskId, staffId, unitId, tag: TAG }));
const passed = results.filter((r) => r.ok).length;
console.log(`\nKết quả: ${passed} PASS, ${results.length - passed} FAIL / ${results.length} kiểm tra.`);
process.exit(results.length - passed ? 1 : 0);
