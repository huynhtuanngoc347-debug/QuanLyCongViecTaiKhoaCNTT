// Phase 3 — tác vụ nhắc hạn trên BẢN SAO (5090). Quyền: chỉ quản trị.
const B = (process.argv[2] || 'http://localhost:5090').replace(/\/$/, '');
if (/:5080\b/.test(B)) process.exit(2);
const login = async (e) => (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'Demo@CNTT2026!' }) })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const run = async (c) => { const r = await fetch(B + '/api/he-thong/chay-nhac-han', { method: 'POST', headers: { Cookie: c } }); return [r.status, await r.text()]; };
const a1 = await run(await login('admin.demo@example.invalid'));
const a2 = await run(await login('admin.demo@example.invalid'));
const h = await run(await login('hand@huit.edu.vn'));
const ok = a1[0] === 200 && a2[0] === 200 && h[0] === 403;
console.log(`${ok ? 'PASS' : 'FAIL'} JOB-01 Quản trị chạy nhắc hạn 200 (${a1[1]}); chạy lần 2 200 (${a2[1]}); giảng viên 403 (${h[0]})`);
