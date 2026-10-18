// Quét giao diện bằng Edge headless (CHỈ ĐỌC: không bấm nút ghi dữ liệu).
// Mỗi vai trò: đăng nhập 1 lần, đi qua các trang ở 1366px và 390px, ghi lỗi console, lỗi JS, request ≥ 400, tràn ngang.
// node ui-sweep.mjs <email> <base> <hash...>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [email, base, ...hashes] = process.argv.slice(2);
const tag = email.split('@')[0] + (base.includes('/m/') ? '-m' : '');
const outDir = `shots/qa/${tag}`; mkdirSync(outDir, { recursive: true });
const port = 9333 + Math.floor(Math.random() * 500);
const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edge-qa-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 50 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(200); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const w = new Map(); let events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') events.push(['jsError', m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text]);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) events.push(['console.' + m.params.type, m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)]);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) events.push(['http', `${m.params.response.status} ${m.params.response.url.replace(/^https?:\/\/[^/]+/, '')}`]);
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) events.push(['netFail', m.params.errorText]);
});
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
const size = async (W) => cdp('Emulation.setDeviceMetricsOverride', { width: W, height: W < 760 ? 844 : 860, deviceScaleFactor: 1, mobile: W < 760 });
await size(1366);
await cdp('Page.navigate', { url: base }); await sleep(1500);
const login = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:'Demo@CNTT2026!'})}).then(r=>r.status)`);
console.log(`[${tag}] login ${login}`);
if (login !== 200) { ws.close(); proc.kill(); process.exit(1); }
await ev(`(()=>{try{for(let u=1;u<80;u++)localStorage.setItem('khoa.dueAlert.'+u+'.'+new Date(Date.now()+7*3600e3).toISOString().slice(0,10),'1')}catch{}})()`);
const results = [];
for (const W of [1366, 390]) {
  await size(W);
  for (const h of hashes) {
    events = [];
    await cdp('Page.navigate', { url: base + '#' + h }); await sleep(400); await ev('location.reload()'); await sleep(3200);
    const info = await ev(`(()=>{const sw=document.documentElement.scrollWidth;const h1=document.querySelector('h1')?.textContent?.trim().slice(0,60)||'';
      const over=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+2&&getComputedStyle(e).position!=='fixed'&&!e.closest('.table-wrap,dialog')}).slice(0,3).map(e=>e.tagName+'.'+[...e.classList].slice(0,2).join('.'));
      const spin=!!document.querySelector('.spinner, [role=status] .animate-spin');const err=[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim().slice(0,80)).filter(Boolean);
      return {sw,h1,over,spin,err}})()`);
    const name = `${W}-${h.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`;
    const s = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); writeFileSync(`${outDir}/${name}.jpg`, Buffer.from(s.result.data, 'base64'));
    results.push({ W, h, ...info, events: [...events] });
    const flag = (info.sw > W + 2 ? ' OVERFLOW' : '') + (info.spin ? ' STILL-LOADING' : '') + (events.length ? ` EVENTS=${events.length}` : '') + (info.err.length ? ` ALERT` : '');
    console.log(`[${tag}] ${W} ${h.padEnd(34)} h1="${info.h1}"${flag}`);
    for (const e of events) console.log(`        ${e[0]}: ${e[1]}`);
    for (const e of info.err) console.log(`        role=alert: ${e}`);
    if (info.over.length) console.log(`        overflow els: ${info.over.join(', ')}`);
  }
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 1));
ws.close(); proc.kill(); process.exit(0);
