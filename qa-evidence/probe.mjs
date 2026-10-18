// Dò quyền + kiểm tra đầu vào. Chỉ GET, hoặc lệnh ghi với dữ liệu CỐ TÌNH SAI (không thể ghi vào CSDL).
const B = 'http://localhost:5080';
async function login(email) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Demo@CNTT2026!' }) });
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), raw: r.headers.getSetCookie() };
}
async function call(c, method, p, body) {
  const r = await fetch(B + p, { method, headers: { ...(c ? { Cookie: c } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { s: r.status, t: t.slice(0, 170), h: r.headers };
}
const row = (id, desc, exp, res) => console.log(`${id}\t${desc}\texpect ${exp}\tgot ${res.s}\t${String(res.t).replace(/\s+/g, ' ')}`);

const hand = (await login('hand@huit.edu.vn')).cookie;
const admin = (await login('admin.demo@example.invalid')).cookie;
const L = await login('vunh@huit.edu.vn');
console.log('COOKIE ATTRS:', L.raw.map((c) => c.replace(/=[^;]+/, '=…')).join(' || '));

// A. Chưa đăng nhập
for (const p of ['/api/to-chuc', '/api/cong-viec?scope=all', '/api/tep/4', '/api/nhan-su/3', '/api/thong-ke/don-vi']) row('A', 'anon GET ' + p, 401, await call(null, 'GET', p));

// B. Giảng viên đọc dữ liệu ngoài phạm vi
const scopeRes = await fetch(B + '/api/cong-viec?scope=all', { headers: { Cookie: hand } });
const handScope = (await scopeRes.json()).items.map((t) => t.id);
console.log('hand scope ids', handScope.join(','));
for (const id of [16, 13, 11, 2]) row('B', `hand GET /api/cong-viec/${id}`, handScope.includes(id) ? 200 : '403/404', await call(hand, 'GET', `/api/cong-viec/${id}`));
for (const id of [16, 13]) row('B', `hand GET /api/cong-viec/${id}/binh-luan`, '403/404', await call(hand, 'GET', `/api/cong-viec/${id}/binh-luan`));
for (const id of [16, 13]) row('B', `hand GET /api/cong-viec/${id}/lich-su`, '403/404', await call(hand, 'GET', `/api/cong-viec/${id}/lich-su`));
for (const f of [10, 4, 3, 21]) row('B', `hand GET /api/tep/${f}`, '403/404', await call(hand, 'GET', `/api/tep/${f}`));
row('B', 'hand GET /api/nhat-ky', 403, await call(hand, 'GET', '/api/nhat-ky?limit=5'));
row('B', 'hand GET /api/thong-ke/don-vi', '403?', await call(hand, 'GET', '/api/thong-ke/don-vi'));
row('B', 'hand GET /api/thong-ke/ca-nhan?person=33', '403', await call(hand, 'GET', '/api/thong-ke/ca-nhan?person=33'));
row('B', 'hand GET /api/nhan-su/33', '?', await call(hand, 'GET', '/api/nhan-su/33'));
row('B', 'hand GET /api/nhan-su', '?', await call(hand, 'GET', '/api/nhan-su'));
row('B', 'hand GET /api/trang/admin', 403, await call(hand, 'GET', '/api/trang/admin'));
row('B', 'hand GET lua-chon-giao-viec?taskId=16', 403, await call(hand, 'GET', '/api/cong-viec/lua-chon-giao-viec?taskId=16'));

// C. Giảng viên gọi lệnh ghi không có quyền (dữ liệu sai → không thể ghi)
row('C', 'hand POST /api/don-vi {}', 403, await call(hand, 'POST', '/api/don-vi', {}));
row('C', 'hand POST /api/nhan-su {}', 403, await call(hand, 'POST', '/api/nhan-su', {}));
row('C', 'hand PUT /api/nhan-su/33 {}', 403, await call(hand, 'PUT', '/api/nhan-su/33', {}));
row('C', 'hand PUT /api/nhan-su/999999/trang-thai {}', 403, await call(hand, 'PUT', '/api/nhan-su/999999/trang-thai', {}));
row('C', 'hand DELETE /api/nhan-su/999999', 403, await call(hand, 'DELETE', '/api/nhan-su/999999'));
row('C', 'hand PUT /api/chuc-vu/999999/quyen "x"', 403, await call(hand, 'PUT', '/api/chuc-vu/999999/quyen', 'x'));
row('C', 'hand POST /api/thanh-vien {}', 403, await call(hand, 'POST', '/api/thanh-vien', {}));
row('C', 'hand POST /api/the-loai {}', 403, await call(hand, 'POST', '/api/the-loai', {}));
row('C', 'hand DELETE /api/mau-cong-viec/999999', '403/404', await call(hand, 'DELETE', '/api/mau-cong-viec/999999'));
row('C', 'hand PUT /api/cong-viec/16 {}', 403, await call(hand, 'PUT', '/api/cong-viec/16', {}));
row('C', 'hand POST cong-viec/16/trang-thai {action:zzz}', 403, await call(hand, 'POST', '/api/cong-viec/16/trang-thai', { action: 'zzz' }));
row('C', 'hand POST cong-viec/16/phan-cong {}', 403, await call(hand, 'POST', '/api/cong-viec/16/phan-cong', {}));
row('C', 'hand POST cong-viec/16/binh-luan {content:""}', 403, await call(hand, 'POST', '/api/cong-viec/16/binh-luan', { content: '' }));
row('C', 'hand POST phan-cong/15/tien-do {percent:999}', 403, await call(hand, 'POST', '/api/phan-cong/15/tien-do', { percent: 999, note: '' }));
row('C', 'hand POST ket-qua/10/danh-gia {decision:99}', 403, await call(hand, 'POST', '/api/ket-qua/10/danh-gia', { decision: 99, comment: '' }));
row('C', 'hand POST phan-cong/15/gia-han {}', 403, await call(hand, 'POST', '/api/phan-cong/15/gia-han', {}));
row('C', 'hand POST phan-cong/15/huy {reason:""}', 403, await call(hand, 'POST', '/api/phan-cong/15/huy', { reason: '' }));
row('C', 'hand POST phan-cong/15/xin-tu-choi {reason:""}', 403, await call(hand, 'POST', '/api/phan-cong/15/xin-tu-choi', { reason: '' }));

// D. Kiểm tra đầu vào (không ghi)
row('D', 'GET /api/cong-viec/abc', 400, await call(admin, 'GET', '/api/cong-viec/abc'));
row('D', 'GET /api/cong-viec/999999', 404, await call(admin, 'GET', '/api/cong-viec/999999'));
row('D', 'GET /api/cong-viec?scope=hacker', 400, await call(admin, 'GET', '/api/cong-viec?scope=hacker'));
row('D', 'GET /api/thong-bao?limit=100000', '200 clamp', await call(admin, 'GET', '/api/thong-bao?limit=100000'));
row('D', 'GET /api/nhat-ky?limit=-5', '400/clamp', await call(admin, 'GET', '/api/nhat-ky?limit=-5'));
row('D', 'GET thong-ke/don-vi from>to', 400, await call(admin, 'GET', '/api/thong-ke/don-vi?from=2027-01-01&to=2026-01-01'));
row('D', 'GET thong-ke/don-vi from=abc', 400, await call(admin, 'GET', '/api/thong-ke/don-vi?from=abc&to=xyz'));
row('D', 'GET thong-ke/don-vi 1900..2999', '200/400', await call(admin, 'GET', '/api/thong-ke/don-vi?from=1900-01-01&to=2999-12-31'));
row('D', 'POST login body rỗng', 400, await call(null, 'POST', '/api/auth/login', {}));
const bad = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
row('D', 'POST login JSON hỏng', 400, { s: bad.status, t: (await bad.text()).slice(0, 120) });
row('D', 'POST login email 5000 ký tự', 400, await call(null, 'POST', '/api/auth/login', { email: 'a'.repeat(5000), password: 'x' }));
row('D', "GET cong-viec?scope=all' OR 1=1--", 400, await call(admin, 'GET', "/api/cong-viec?scope=all'%20OR%201=1--"));
row('D', 'GET /api/tep/999999', 404, await call(admin, 'GET', '/api/tep/999999'));
row('D', 'GET /api/tep/-1', 400, await call(admin, 'GET', '/api/tep/-1'));
row('D', 'POST login body 3MB', 413, await call(null, 'POST', '/api/auth/login', { email: 'x@y.z', password: 'p'.repeat(3_000_000) }));

// E. Đăng nhập sai liên tiếp (email KHÔNG tồn tại → không ghi nhật ký cho người thật)
let last;
for (let i = 0; i < 12; i++) last = await call(null, 'POST', '/api/auth/login', { email: 'khong.ton.tai@example.invalid', password: 'sai' + i });
row('E', '12 lần đăng nhập sai liên tiếp', 429, last);

// F. Header bảo mật, CORS
const h = (await call(null, 'GET', '/')).h;
console.log('HEADERS /:', ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security', 'cache-control'].map((k) => `${k}=${h.get(k)}`).join(' | '));
const ha = (await call(admin, 'GET', '/api/to-chuc')).h;
console.log('HEADERS /api:', ['x-content-type-options', 'cache-control', 'access-control-allow-origin'].map((k) => `${k}=${ha.get(k)}`).join(' | '));
const hc = await fetch(B + '/api/to-chuc', { headers: { Cookie: admin, Origin: 'https://evil.example' } });
console.log('CORS evil origin → ACAO=', hc.headers.get('access-control-allow-origin'), 'status', hc.status);
