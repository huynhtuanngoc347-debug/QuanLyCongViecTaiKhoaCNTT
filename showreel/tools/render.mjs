// Render the showreel to MP4 (or stills) with headless Chromium + ffmpeg.
//   node tools/render.mjs --lang vi --out out/HUIT_showreel_16x9_VI.mp4
//   node tools/render.mjs --lang vi --stills 200,250,300 --dir out/stills
//   node tools/render.mjs --lang vi --cut short --out out/HUIT_short_16x9_VI.mp4   (30 s cut)
//   node tools/render.mjs --stills beats --dir out/beats        (one still per beat → contact sheet)
// The page is served over a tiny local HTTP server so the frozen app states
// (app/states/*.html, loaded in iframes) are same-origin and can be animated.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFile } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const W = +(args.w || 1920), H = +(args.h || 1080), lang = args.lang || 'vi';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html?w=${W}&h=${H}&lang=${lang}` + (args.test ? `&test=${args.test}` : '') + (args.cut ? `&cut=${args.cut}` : '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(url);
const info = await page.evaluate(() => window.reelReady);
const shot = async (f) => { await page.evaluate((f) => window.renderFrame(f), f); return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } }); };

if (args.stills) {
  const dir = path.resolve(args.dir || 'out/stills'); mkdirSync(dir, { recursive: true });
  const frames = args.stills === 'beats' ? Array.from({ length: Math.ceil(info.frames / 15) }, (_, i) => i * 15 + +(args.offset ?? 7))
    : String(args.stills).includes('-') ? (() => { const [a, z, s] = String(args.stills).split(/[-:]/).map(Number); return Array.from({ length: Math.floor((z - a) / (s || 1)) + 1 }, (_, i) => a + i * (s || 1)); })()
    : String(args.stills).split(',').map(Number);
  for (const f of frames) writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.png`), await shot(f));
  console.log(`stills: ${frames.length} → ${dir}`);
} else {
  const out = path.resolve(args.out || `out/HUIT_showreel_${W}x${H}_${lang}.mp4`); mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(info.fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const from = +(args.from || 0), to = Math.min(info.frames, +(args.to || info.frames));
  for (let f = from; f < to; f++) {
    const buf = await shot(f);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) process.stdout.write(`${f}/${info.frames} `);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\n→ ${out}`);
}
await browser.close();
server.close();
