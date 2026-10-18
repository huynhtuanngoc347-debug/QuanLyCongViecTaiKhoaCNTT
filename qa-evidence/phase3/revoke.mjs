// NEW-P3-01 — thu hồi phiên khi đăng xuất. Chạy trên BẢN SAO (5090) đã có bảng dbo.PhienDaThuHoi.
// node qa-evidence/phase3/revoke.mjs http://localhost:5090
const BASE = (process.argv[2] || 'http://localhost:5090').replace(/\/$/, '');
if (/:5080\b/.test(BASE) && !process.env.ALLOW_PROD_READONLY) { console.error('Từ chối: 5080 là CSDL thật.'); process.exit(2); }
const PASS = 'Demo@CNTT2026!';
const out = [];
const check = (id, name, ok, ev) => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} — ${ev}`); };
async function call(method, p, { cookie, bearer, body, mobile } = {}) {
  const r = await fetch(BASE + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(mobile ? { 'X-Client': 'mobile' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  const sc = r.headers.getSetCookie?.() ?? [];
  const get = (n) => sc.find((c) => c.startsWith(n + '=') && !/^[^=]+=;/.test(c))?.split(';')[0];
  return { status: r.status, data, at: get('khoa_at'), rt: get('khoa_rt') };
}
const login = (email, mobile) => call('POST', '/api/auth/login', { body: { email, password: PASS }, mobile });

// Web: phiên A và phiên B của cùng một người.
const a = await login('hand@huit.edu.vn');
const b = await login('hand@huit.edu.vn');
const r1 = await call('POST', '/api/auth/refresh', { cookie: a.rt });            // refresh: cấp token mới cùng phiên
const atNew = r1.at, rtNew = r1.rt;
const before = await call('GET', '/api/auth/me', { cookie: atNew });
const out1 = await call('POST', '/api/auth/logout', { cookie: `${atNew}; ${rtNew}` });
const oldAt = await call('GET', '/api/auth/me', { cookie: a.at });
const newAt = await call('GET', '/api/auth/me', { cookie: atNew });
const oldRt = await call('POST', '/api/auth/refresh', { cookie: a.rt });
const newRt = await call('POST', '/api/auth/refresh', { cookie: rtNew });
const other = await call('GET', '/api/auth/me', { cookie: b.at });
const otherRt = await call('POST', '/api/auth/refresh', { cookie: b.rt });
check('REV-01', 'Trước khi đăng xuất phiên dùng được; đăng xuất 204', before.status === 200 && out1.status === 204, `me=${before.status} logout=${out1.status}`);
check('REV-02', 'Sau đăng xuất: access token cũ và mới đều 401', oldAt.status === 401 && newAt.status === 401, `at-ban-đầu=${oldAt.status} at-sau-refresh=${newAt.status}`);
check('REV-03', 'Sau đăng xuất: refresh token hiện tại VÀ refresh token cũ (trước lần refresh) đều 401', oldRt.status === 401 && newRt.status === 401, `rt-cũ=${oldRt.status} rt-mới=${newRt.status}`);
check('REV-04', 'Phiên khác của cùng người dùng (máy khác) không bị ảnh hưởng', other.status === 200 && otherRt.status === 200, `me=${other.status} refresh=${otherRt.status}`);

// App di động: Bearer + refreshToken trong thân.
const m = await login('trangntt@huit.edu.vn', true);
const t = m.data?.tokens;
const mMe = await call('GET', '/api/auth/me', { bearer: t?.accessToken });
const mOut = await call('POST', '/api/auth/logout', { bearer: t?.accessToken, body: { refreshToken: t?.refreshToken }, mobile: true });
const mMe2 = await call('GET', '/api/auth/me', { bearer: t?.accessToken });
const mRt = await call('POST', '/api/auth/refresh', { body: { refreshToken: t?.refreshToken }, mobile: true });
check('REV-05', 'App di động: đăng xuất thu hồi cả access token (Bearer) và refreshToken', mMe.status === 200 && mOut.status === 204 && mMe2.status === 401 && mRt.status === 401, `me=${mMe.status} logout=${mOut.status} me-sau=${mMe2.status} refresh-sau=${mRt.status}`);

// Đăng nhập lại sau khi đăng xuất vẫn bình thường (phiên mới).
const again = await login('hand@huit.edu.vn');
const againMe = await call('GET', '/api/auth/me', { cookie: again.at });
check('REV-06', 'Đăng nhập lại sau khi đăng xuất → phiên mới dùng được', again.status === 200 && againMe.status === 200, `login=${again.status} me=${againMe.status}`);

// Không thể dùng refresh token của người khác để thu hồi phiên của họ (chỉ thu hồi khi sub trùng người đăng xuất).
const victim = await login('baopt@huit.edu.vn');
const attacker = await login('hand@huit.edu.vn');
const cross = await call('POST', '/api/auth/logout', { cookie: attacker.at, body: { refreshToken: victim.rt?.slice('khoa_rt='.length) } });
const victimRt = await call('POST', '/api/auth/refresh', { cookie: victim.rt });
check('REV-07', 'Gửi refresh token của người khác khi đăng xuất không thu hồi phiên của họ', cross.status === 204 && victimRt.status === 200, `logout=${cross.status} refresh-nạn-nhân=${victimRt.status}`);
console.log(`\nKết quả: ${out.filter(Boolean).length} PASS, ${out.filter((x) => !x).length} FAIL.`);
process.exit(out.every(Boolean) ? 0 : 1);
