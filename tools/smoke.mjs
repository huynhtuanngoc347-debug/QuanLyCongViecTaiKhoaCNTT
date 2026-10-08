// Kiểm tra nhanh API NestJS với SQL Server THẬT (chỉ đọc, không ghi dữ liệu).
// Cách chạy (API đang chạy ở cổng 5080):   npm run smoke
// Hoặc: node tools/smoke.mjs http://localhost:5080 "Demo@CNTT2026!"
const BASE = (process.argv[2] || process.env.API_URL || 'http://localhost:5080').replace(/\/$/, '');
const PASSWORD = process.argv[3] || process.env.SMOKE_PASSWORD || 'Demo@CNTT2026!';
const ACCOUNTS = [
  ['admin.demo@example.invalid', 'Quản trị'],
  ['vunh@huit.edu.vn', 'Trưởng khoa'],
  ['baopt@huit.edu.vn', 'Trưởng bộ môn'],
  ['hand@huit.edu.vn', 'Giảng viên'],
];
let pass = 0, fail = 0;
const line = (okay, text) => { okay ? pass++ : fail++; console.log(`${okay ? '  ✓' : '  ✗'} ${text}`); };

async function call(cookie, method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

console.log(`Kiểm tra API tại ${BASE}`);
const health = await call(null, 'GET', '/api/health').catch((e) => ({ status: 0, data: { message: e.message } }));
line(health.status === 200, `GET /api/health → ${health.status} ${JSON.stringify(health.data)}`);
if (health.status !== 200) { console.log('\nAPI chưa chạy hoặc chưa kết nối được SQL Server. Xem cửa sổ chạy API.'); process.exit(1); }
line(health.data.taskModule === true, 'Đã chạy sql/03_PhanHeCongViec.sql (taskModule: true)');

for (const [email, label] of ACCOUNTS) {
  console.log(`\n${label} (${email})`);
  const login = await call(null, 'POST', '/api/auth/login', { email, password: PASSWORD });
  line(login.status === 200, `Đăng nhập → ${login.status}${login.status !== 200 ? ' ' + JSON.stringify(login.data) : ''}`);
  if (login.status !== 200) continue;
  const cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ');
  const portals = login.data.portals.map((p) => p.key);
  line(portals.length > 0, `Trang theo vai trò: ${portals.join(', ')}`);
  const paths = [
    '/api/auth/me', '/api/to-chuc', '/api/don-vi', '/api/nhan-su', '/api/chuc-vu', ...portals.map((k) => `/api/trang/${k}`),
    '/api/cong-viec?scope=assigned', '/api/cong-viec?scope=created', '/api/cong-viec?scope=all', '/api/cong-viec?scope=review',
    '/api/cong-viec/lua-chon-giao-viec', '/api/the-loai', '/api/mau-cong-viec', '/api/thong-bao?limit=30', '/api/canh-bao-han',
    '/api/thong-ke/ca-nhan',
  ];
  if (login.data.user.isSystemAdmin || login.data.tasks.reportUnitIds.length || login.data.tasks.assignUnitIds.length) paths.push('/api/thong-ke/don-vi');
  if (login.data.user.isSystemAdmin) paths.push('/api/nhat-ky?limit=20');
  let firstTask = null;
  for (const p of paths) {
    const r = await call(cookie, 'GET', p);
    line(r.status === 200, `GET ${p} → ${r.status}${r.status !== 200 ? ' ' + (r.data?.message ?? '') : ''}`);
    if (p.startsWith('/api/cong-viec?scope=all') && r.data?.items?.length) firstTask = r.data.items[0].id;
  }
  if (firstTask) {
    for (const p of [`/api/cong-viec/${firstTask}`, `/api/cong-viec/${firstTask}/binh-luan`, `/api/cong-viec/${firstTask}/lich-su`]) {
      const r = await call(cookie, 'GET', p);
      line(r.status === 200, `GET ${p} → ${r.status}${r.status !== 200 ? ' ' + (r.data?.message ?? '') : ''}`);
    }
  }
  const bad = await call(cookie, 'GET', '/api/trang/khong-co');
  line(bad.status === 404, `Trang không tồn tại → ${bad.status}`);
  const out = await call(cookie, 'POST', '/api/auth/logout');
  line(out.status === 204, `Đăng xuất → ${out.status}`);
}
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi.`);
if (fail) console.log('Gửi toàn bộ nội dung trên cho Claude để sửa.');
process.exit(fail ? 1 : 0);
