// SUS-04: nhập dở biểu mẫu "Tạo công việc" rồi bấm Back — cảnh báo "chưa lưu" có hiện không? (Edge headless, không lưu gì)
// Chạy: node qa-evidence/phase3/sus04-back.mjs http://localhost:5090/
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] || 'http://localhost:5090/';
const port = 9333 + Math.floor(Math.random() * 500);
const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edge-s4-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 50 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(200); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const w = new Map(); const warns = []; const native = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } if (m.method === 'Page.javascriptDialogOpening') { native.push(m.params.type); ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') warns.push(m.params.args.map((a) => a.value).join(' ').slice(0, 90)); });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: BASE }); await sleep(1200);
await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'vunh@huit.edu.vn',password:'Demo@CNTT2026!'})}).then(r=>r.status)`);
await ev(`(()=>{try{for(let u=1;u<80;u++)localStorage.setItem('khoa.dueAlert.'+u+'.'+new Date(Date.now()+7*3600e3).toISOString().slice(0,10),'1')}catch{}})()`);

const state = () => ev(`({hash:location.hash, dialog:[...document.querySelectorAll('dialog[open]')].map(d=>d.textContent.trim().replace(/\\s+/g,' ').slice(0,90))})`);
async function scenario(label, openForm) {
  // Bắt đầu từ trang sạch: rời hẳn tài liệu (hộp thoại beforeunload nếu có được tự chấp nhận) rồi tải lại danh sách.
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(800);
  await cdp('Page.navigate', { url: BASE + '#/cong-viec' }); await sleep(3000);
  if (!(await state()).hash.startsWith('#/cong-viec') || (await state()).hash !== '#/cong-viec') throw new Error('không về được trang danh sách: ' + (await state()).hash);
  await openForm(); await sleep(2000);
  const formHash = (await state()).hash;
  await ev(`document.querySelector('input[name=title]')?.focus()`);
  await cdp('Input.insertText', { text: 'Nhập dở — không lưu' });
  await sleep(400);
  warns.length = 0;
  await ev('history.back()'); await sleep(1500);
  const s = await state();
  const guarded = s.hash === formHash && s.dialog.length > 0;
  console.log(`${guarded ? 'PASS' : 'FAIL'} SUS-04 ${label}: form=${formHash} sau-Back=${s.hash} hộp-thoại=${JSON.stringify(s.dialog)} cảnh-báo-console=${JSON.stringify(warns)}`);
  if (s.dialog.length) { await ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>/Tiếp tục chỉnh sửa|Ở lại|Hủy/i.test(b.textContent))?.click()`); await sleep(500); }
  return guarded;
}
// Ca 1: người dùng vào biểu mẫu bằng liên kết trong ứng dụng (cách dùng thông thường).
const a = await scenario('vào bằng nút "Tạo công việc" trong ứng dụng', () => ev(`[...document.querySelectorAll('a,button')].find(x=>/Tạo công việc/.test(x.textContent))?.click()`));
// Ca 2: người dùng gõ địa chỉ /cong-viec/tao vào thanh địa chỉ (mục lịch sử không do router tạo).
const b = await scenario('gõ địa chỉ #/cong-viec/tao vào thanh địa chỉ', async () => { await cdp('Page.navigate', { url: BASE + '#/cong-viec/tao' }); });
console.log(`\nKết quả: ${[a, b].filter(Boolean).length} PASS, ${[a, b].filter((x) => !x).length} FAIL.`);
ws.close(); proc.kill(); process.exit(0);
