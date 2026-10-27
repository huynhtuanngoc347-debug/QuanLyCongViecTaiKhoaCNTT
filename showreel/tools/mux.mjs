// Put sound under a rendered (silent) video.
//   node tools/mux.mjs out/HUIT_showreel_16x9_VI.mp4 --score      use the synthesised score (audio/score_mix.wav,
//                                                                   made by: python3 tools/compose_audio.py)
//   node tools/mux.mjs out/HUIT_showreel_16x9_VI.mp4 [audio-dir]   use your own files: music.mp3|wav + <sfx>.wav
//                                                                   (hit, tick, click, open, toast, chime, whoosh, move,
//                                                                   riser, typing, detents) placed on REEL.AUDIO cues
// Output: <video>_audio.mp4, loudness-normalised to about -14 LUFS, true peak ≤ -1 dBTP.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cutArg = process.argv.indexOf('--cut'), CUT = cutArg > 0 ? process.argv[cutArg + 1] : (process.env.REEL_CUT || 'full');
const ctx = { window: { REEL_CUT: CUT } }; vm.runInNewContext(readFileSync(path.join(root, 'timeline.js'), 'utf8'), ctx);
const R = ctx.window.REEL;
const video = process.argv[2];
if (!video) { console.error('usage: node tools/mux.mjs <video.mp4> [--score | audio-dir]'); process.exit(1); }
const useScore = process.argv.includes('--score');
const dir = path.resolve(useScore ? path.join(root, 'audio') : (process.argv[3] || path.join(root, 'audio')));
const DUR = R.TOTAL_FRAMES / R.FPS;
const out = video.replace(/\.mp4$/, '_audio.mp4');

let inputs = ['-i', video], filter;
if (useScore) {
  const f = path.join(dir, `score_mix${CUT === 'full' ? '' : '_' + CUT}.wav`);
  if (!existsSync(f)) { console.error('audio/score_mix.wav not found — run: python3 tools/compose_audio.py'); process.exit(1); }
  inputs.push('-i', f);
  filter = `[1:a]atrim=0:${DUR}[m]`;
} else {
  const chains = [], mixes = []; let n = 1;
  const music = ['music.wav', 'music.mp3'].map((x) => path.join(dir, x)).find(existsSync);
  if (music) { inputs.push('-i', music); chains.push(`[${n}:a]atrim=0:${DUR},afade=t=out:st=${DUR - 1.5}:d=1.5[a${n}]`); mixes.push(`[a${n}]`); n++; }
  for (const cue of R.AUDIO) {
    const f = path.join(dir, `${cue.sfx}.wav`); if (!existsSync(f)) continue;
    const ms = Math.round((R.b(cue.beat) / R.FPS) * 1000);
    inputs.push('-i', f); chains.push(`[${n}:a]adelay=${ms}|${ms}[a${n}]`); mixes.push(`[a${n}]`); n++;
  }
  if (!mixes.length) { console.log(`No audio files found in ${dir} — nothing to mux.`); process.exit(0); }
  filter = `${chains.join(';')};${mixes.join('')}amix=inputs=${mixes.length}:normalize=0[m]`;
}
// measure loudness, then apply one static gain (no pumping) + a true-peak limiter
const probe = spawnSync('ffmpeg', ['-hide_banner', ...inputs, '-filter_complex', `${filter};[m]loudnorm=print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
const m = probe.stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
const gain = m ? Math.min(12, -14 - parseFloat(m[1])) : 0;
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${filter};[m]volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=false[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', String(DUR), '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(r.status === 0 ? `→ ${out}  (gain ${gain.toFixed(1)} dB → ~-14 LUFS)` : 'ffmpeg failed');
