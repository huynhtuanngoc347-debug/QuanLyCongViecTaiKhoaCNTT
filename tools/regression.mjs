// Kiểm thử hồi quy qua HTTP cho các lỗi trong QA_AUDIT_REPORT.md (CHỈ ĐỌC: không ghi dữ liệu).
// Lệnh ghi (nếu có) luôn gửi dữ liệu sai để máy chủ từ chối ở bước kiểm tra, không thể lưu vào CSDL.
// Chạy (API đang chạy ở cổng 5080):  npm run regression
// Hoặc: node tools/regression.mjs http://localhost:5080 "<mật khẩu tài khoản mẫu>"
const BASE = (process.argv[2] || process.env.API_URL || 'http://localhost:5080').replace(/\/$/, '');
const PASSWORD = process.argv[3] || process.env.SMOKE_PASSWORD || 'Demo@CNTT2026!';
let pass = 0, fail = 0;
const line = (ok, text) => { ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${text}`); };

async function call(cookie, method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  return { status: res.status, data, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [] };
}
async function login(email) {
  const r = await call(null, 'POST', '/api/auth/login', { email, password: PASSWORD });
  return { status: r.status, cookie: r.setCookie.map((c) => c.split(';')[0]).join('; ') };
}

console.log(`Kiểm thử hồi quy tại ${BASE}\n`);

console.log('BUG-P1-01 — chặn đăng nhập chỉ đếm lần nhập SAI');
// 12 lượt đăng nhập ĐÚNG liên tiếp từ cùng IP (trước đây lượt thứ 11 bị 429).
let okCount = 0, last = 0;
for (let i = 0; i < 12; i++) { const r = await login(i % 2 ? 'hand@huit.edu.vn' : 'baopt@huit.edu.vn'); last = r.status; if (r.status === 200) okCount++; }
line(okCount === 12, `12 lượt đăng nhập đúng liên tiếp đều thành công (${okCount}/12, lượt cuối ${last})`);
// 10 lần sai với một email KHÔNG tồn tại → lần 11 bị 429; email thật cùng IP vẫn đăng nhập được.
const ghost = `khong.ton.tai.${Date.now()}@example.invalid`;
let wrong = [];
for (let i = 0; i < 11; i++) wrong.push((await call(null, 'POST', '/api/auth/login', { email: ghost, password: 'sai-' + i })).status);
line(wrong.slice(0, 10).every((s) => s === 401) && wrong[10] === 429, `10 lần sai → 401, lần 11 → 429 (${wrong.join(',')})`);
const after = await login('hand@huit.edu.vn');
line(after.status === 200, `Tài khoản khác cùng IP vẫn đăng nhập được sau khi một email bị khóa (${after.status})`);

const admin = (await login('admin.demo@example.invalid')).cookie;
const hand = (await login('hand@huit.edu.vn')).cookie;

console.log('\nBUG-P2-02 — chống nhúng trang (clickjacking)');
for (const p of ['/', '/m/', '/api/health']) {
  const r = await call(null, 'GET', p);
  line(r.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(r.headers.get('content-security-policy') ?? ''), `${p}: X-Frame-Options=${r.headers.get('x-frame-options')}, CSP=${r.headers.get('content-security-policy')}`);
}

console.log('\nBUG-P3-01 — thân JSON quá lớn');
const big = await call(null, 'POST', '/api/auth/login', { email: 'x@example.invalid', password: 'p'.repeat(3_000_000) });
line(big.status === 413, `Thân 3 MB → ${big.status} ${JSON.stringify(big.data)}`);
const broken = await call(null, 'POST', '/api/auth/login', '{bad');
line(broken.status === 400, `JSON hỏng → ${broken.status}`);

console.log('\nBUG-P3-02 — phạm vi danh sách không hợp lệ');
for (const s of ['hacker', "all' OR 1=1--"]) { const r = await call(admin, 'GET', `/api/cong-viec?scope=${encodeURIComponent(s)}`); line(r.status === 400, `scope=${s} → ${r.status}`); }
for (const s of ['assigned', 'created', 'all', 'review']) { const r = await call(admin, 'GET', `/api/cong-viec?scope=${s}`); line(r.status === 200, `scope=${s} vẫn hoạt động → ${r.status}`); }
const noScope = await call(admin, 'GET', '/api/cong-viec');
line(noScope.status === 200, `Không truyền scope vẫn hoạt động → ${noScope.status}`);

console.log('\nBUG-P3-03 — lựa chọn giao việc cho công việc ngoài quyền');
const handTasks = (await call(hand, 'GET', '/api/cong-viec?scope=all')).data.items.map((t) => t.id);
const allTasks = (await call(admin, 'GET', '/api/cong-viec?scope=all')).data.items.map((t) => t.id);
const outside = allTasks.find((id) => !handTasks.includes(id));
const o = await call(hand, 'GET', `/api/cong-viec/lua-chon-giao-viec?taskId=${outside}`);
line(o.status === 404, `Giảng viên, công việc ${outside} ngoài phạm vi → ${o.status}`);
const own = await call(admin, 'GET', `/api/cong-viec/lua-chon-giao-viec?taskId=${allTasks[0]}`);
line(own.status === 200, `Quản trị, công việc ${allTasks[0]} → ${own.status} (không ảnh hưởng người có quyền)`);
const none = await call(hand, 'GET', '/api/cong-viec/lua-chon-giao-viec');
line(none.status === 200, `Không truyền taskId (dùng khi tạo việc) → ${none.status}`);
const missing = await call(admin, 'GET', '/api/cong-viec/lua-chon-giao-viec?taskId=999999');
line(missing.status === 404, `Công việc không tồn tại → ${missing.status}`);

console.log('\nBUG-P3-05 — limit nhật ký');
const neg = await call(admin, 'GET', '/api/nhat-ky?limit=-5');
const def = await call(admin, 'GET', '/api/nhat-ky');
line(neg.status === 200 && neg.data.length === def.data.length, `limit=-5 trả số dòng mặc định (${neg.data?.length}) như không truyền (${def.data?.length})`);
const two = await call(admin, 'GET', '/api/nhat-ky?limit=2');
line(two.data?.length === 2, `limit=2 → ${two.data?.length} dòng`);

console.log('\nPhân quyền không bị nới lỏng (đối chứng)');
line((await call(hand, 'GET', '/api/nhat-ky')).status === 403, 'Giảng viên xem nhật ký → 403');
line((await call(hand, 'POST', '/api/don-vi', {})).status === 403, 'Giảng viên tạo đơn vị → 403');
line((await call(null, 'GET', '/api/cong-viec?scope=all')).status === 401, 'Chưa đăng nhập → 401');

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi.`);
process.exit(fail ? 1 : 0);
