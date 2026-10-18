// Phase 3 — kiểm thử bổ sung trên BẢN SAO (cổng 5090): giới hạn đổi mật khẩu (P1-01), xác nhận SUS-01.
// Chạy: node qa-evidence/phase3/extra.mjs http://localhost:5090 <thư mục uploads của bản sao>
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const BASE = (process.argv[2] || 'http://localhost:5090').replace(/\/$/, '');
const UPLOADS = process.argv[3];
if (/:5080\b/.test(BASE)) { console.error('Từ chối: 5080 là CSDL thật.'); process.exit(2); }
const PASS = 'Demo@CNTT2026!';
const out = [];
const check = (id, name, ok, ev) => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} — ${ev}`); };
async function call(cookie, method, p, body) {
  const isForm = body instanceof FormData;
  const r = await fetch(BASE + p, { method, headers: { ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}
const login = (e, p = PASS) => call(null, 'POST', '/api/auth/login', { email: e, password: p });
const admin = (await login('admin.demo@example.invalid')).cookie;

// P1-01 (đổi mật khẩu): 10 lần nhập sai mật khẩu hiện tại → lần 11 bị 429, kể cả khi nhập đúng; người khác không bị ảnh hưởng.
const email = `thu.p3.pw.${Date.now().toString(36)}@example.invalid`;
const created = await call(admin, 'POST', '/api/nhan-su', { name: '[THỬ-P3] Đổi mật khẩu', email, isSystemAdmin: false, active: true });
const temp = created.data?.temporaryPassword;
const s = (await login(email, temp)).cookie;
const NEW = 'Thu@P3-Pw' + Date.now().toString(36);
const codes = [];
for (let i = 0; i < 11; i++) codes.push((await call(s, 'POST', '/api/auth/doi-mat-khau', { currentPassword: 'sai-' + i, newPassword: NEW, confirmPassword: NEW })).status);
const correctWhileBlocked = (await call(s, 'POST', '/api/auth/doi-mat-khau', { currentPassword: temp, newPassword: NEW, confirmPassword: NEW })).status;
const hand = (await login('hand@huit.edu.vn')).cookie;
const other = (await call(hand, 'POST', '/api/auth/doi-mat-khau', { currentPassword: 'sai', newPassword: NEW, confirmPassword: NEW })).status;
const stillLogin = (await login(email, temp)).status;
check('P1-01-PWD', '10 lần sai mật khẩu hiện tại → 400; lần 11 → 429; nhập đúng khi đang khóa vẫn 429; người khác không bị khóa (400); đăng nhập vẫn được',
  codes.slice(0, 10).every((c) => c === 400) && codes[10] === 429 && correctWhileBlocked === 429 && other === 400 && stillLogin === 200,
  `sai=${codes.join(',')} đúng-khi-khóa=${correctWhileBlocked} người-khác=${other} đăng-nhập=${stillLogin}`);

// SUS-01: tải tệp vào phân công của người khác.
const list = (await call(admin, 'GET', '/api/cong-viec?scope=all')).data.items;
let target = null;
for (const t of list) {
  const d = (await call(admin, 'GET', `/api/cong-viec/${t.id}`)).data;
  const a = d.assignments?.find((x) => x.personId && x.personId !== 3 && x.status < 4);
  if (a) { target = a; break; }
}
const snapshot = () => { const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } }; walk(UPLOADS); return files; };
const before = snapshot();
const fd = new FormData(); fd.append('content', 'thử'); fd.append('files', new Blob([new Uint8Array(5 * 1048576)], { type: 'application/pdf' }), 'lon.pdf');
const t0 = Date.now();
const r = await call(hand, 'POST', `/api/phan-cong/${target.id}/ket-qua`, fd);
const ms = Date.now() - t0; if (r.status !== 403) console.log('phản hồi:', JSON.stringify(r.data));
const after = snapshot();
const leftover = after.filter((f) => !before.includes(f));
check('SUS-01', 'Người ngoài nộp kết quả vào phân công của người khác → 403 và không để lại tệp trên đĩa', r.status === 403 && leftover.length === 0,
  `phân công=${target.id} (người nhận ${target.personId}) status=${r.status} thời-gian=${ms}ms tệp-còn-lại=${leftover.length} (5 MB đã được gửi lên trước khi bị từ chối)`);
console.log(`\nKết quả: ${out.filter(Boolean).length} PASS, ${out.filter((x) => !x).length} FAIL.`);
