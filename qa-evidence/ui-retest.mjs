// Kiểm lại các lỗi giao diện sau khi sửa (Edge headless, chỉ đọc).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const PASS = process.env.SMOKE_PASSWORD || 'Demo@CNTT2026!';
const port = 9333 + Math.floor(Math.random() * 500);
const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edge-rt-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 50 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(200); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const w = new Map(); const errs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]); });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 65 }); writeFileSync(`shots/${name}.jpg`, Buffer.from(s.result.data, 'base64')); };
const size = (W) => cdp('Emulation.setDeviceMetricsOverride', { width: W, height: W < 760 ? 844 : 860, deviceScaleFactor: 1, mobile: W < 760 });
const go = async (url) => { await cdp('Page.navigate', { url }); await sleep(400); await ev('location.reload()'); await sleep(3500); };
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '  ✓' : '  ✗'} ${name} — ${detail}`); };
await cdp('Page.enable'); await cdp('Runtime.enable');
const loginAs = async (email) => { await cdp('Page.navigate', { url: 'http://localhost:5080/' }); await sleep(1200); const s = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(PASS)}})}).then(r=>r.status)`); await ev(`(()=>{try{for(let u=1;u<80;u++)localStorage.setItem('khoa.dueAlert.'+u+'.'+new Date(Date.now()+7*3600e3).toISOString().slice(0,10),'1')}catch{}})()`); return s; };

// BUG-P2-01: trang chi tiết 390px không tràn ngang
await size(390); console.log('login hand', await loginAs('hand@huit.edu.vn'));
await go('http://localhost:5080/#/cong-viec/chi-tiet?id=1');
const p201 = await ev(`({sw:document.documentElement.scrollWidth,iw:innerWidth,kvOver:[...document.querySelectorAll('.kv')].filter(k=>k.scrollWidth>k.clientWidth+1).length,due:[...document.querySelectorAll('.kv .due')].map(d=>d.textContent).join(' | ')})`);
check('BUG-P2-01 tràn ngang chi tiết 390px', p201.sw <= p201.iw && p201.kvOver === 0, JSON.stringify(p201)); await shot('fix-P2-01');

// BUG-P3-07 + P3-08: app di động
await go('http://localhost:5080/m/#/tasks/16');
const p307 = await ev(`({title:[...document.querySelectorAll('main h1, main h2')].map(h=>h.tagName+':'+h.textContent.trim()).join(' | '), btn:[...document.querySelectorAll('main a')].map(a=>a.textContent.trim()).join(' | ')})`);
check('BUG-P3-07 /m/ công việc ngoài quyền báo "Không tìm thấy công việc"', /Không tìm thấy công việc/.test(p307.title) && !/Chưa thể tải/.test(p307.title), JSON.stringify(p307)); await shot('fix-P3-07');
await go('http://localhost:5080/m/#/tasks/16/update');
const p307b = await ev(`[...document.querySelectorAll('main h1, main h2')].map(h=>h.textContent.trim()).join(' | ')`);
check('BUG-P3-07 /m/ trang cập nhật tiến độ của việc ngoài quyền', /Không tìm thấy công việc/.test(p307b), p307b);
await go('http://localhost:5080/m/#/tasks/2');
const p307c = await ev(`document.querySelector('h1')?.textContent`);
check('Đối chứng: /m/ công việc có quyền vẫn mở bình thường', p307c === 'Chi tiết công việc' && !!(await ev(`document.querySelector('main h2')?.textContent`)), String(p307c));
await go('http://localhost:5080/m/#/khong-co-trang');
const p308 = await ev(`document.querySelector('h1')?.textContent?.trim()`);
check('BUG-P3-08 /m/ trang 404 có h1', p308 === 'Không tìm thấy trang', String(p308));

// BUG-P3-06: đổi kỳ thống kê giữ từ khóa tìm nhân sự
await size(1366); console.log('login vunh', await loginAs('vunh@huit.edu.vn'));
await go('http://localhost:5080/#/thong-ke?q=trang&sort=overdue');
const before = await ev(`({search:document.getElementById('person-search')?.value, rows:document.querySelectorAll('[aria-labelledby=person-stats-title] tbody tr').length})`);
const linkHref = await ev(`[...document.querySelectorAll('.period-bar .seg a')].find(a=>/Năm học/.test(a.textContent))?.getAttribute('href')`);
await ev(`[...document.querySelectorAll('.period-bar .seg a')].find(a=>/Năm học/.test(a.textContent))?.click()`); await sleep(3000);
const afterP = await ev(`({hash:location.hash, search:document.getElementById('person-search')?.value, sort:document.querySelector('[aria-label="Sắp xếp nhân sự"]')?.value, rows:document.querySelectorAll('[aria-labelledby=person-stats-title] tbody tr').length})`);
check('BUG-P3-06 đổi kỳ giữ từ khóa + sắp xếp', /q=trang/.test(afterP.hash) && afterP.search === 'trang' && afterP.sort === 'overdue' && /period=year/.test(afterP.hash), `trước=${JSON.stringify(before)} link=${linkHref} sau=${JSON.stringify(afterP)}`);
await shot('fix-P3-06');

console.log('JS errors:', errs.length ? errs : 'none');
console.log(`\nKết quả: ${results.filter(Boolean).length} đạt, ${results.filter((x) => !x).length} lỗi.`);
ws.close(); proc.kill(); process.exit(0);
