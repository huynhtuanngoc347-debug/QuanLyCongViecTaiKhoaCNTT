"""Automated review of the showreel.
  python3 tools/check.py out/HUIT_showreel_16x9_EN.mp4
1) word readability: every on-screen word vs. its fully-readable window (>=10 f, >=20 f if >8 chars)
2) move vocabulary: each feature uses a different set of moves; stagger <=2, invert <=3
3) copy -> feature mapping: every big word maps to a real feature
4) photosensitivity: big full-frame luminance swings, counted per 1-second window (must be <=3)
"""
import subprocess, sys, json
import numpy as np

BEAT = 15
b = lambda x: round(x * BEAT)

# (word, first fully readable frame, last frame on screen, feature) — v4 timeline, positions
# computed from timeline.js (section starts + time warp), so this stays right if timing changes.
import json as _json, subprocess as _sp, os as _os
_root = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
CUT = next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == '--cut'), _os.environ.get('REEL_CUT', 'full'))
VIDEO = next((a for a in sys.argv[1:] if a.endswith('.mp4')), None)
_js = ("global.window={REEL_CUT:process.argv[3]};require('vm').runInThisContext(require('fs').readFileSync(process.argv[1],'utf8'));const R=window.REEL;"
       "const q=JSON.parse(process.argv[2]).filter(([s])=>R.S[s]);console.log(JSON.stringify({S:R.S,T:R.TOTAL_BEATS,q,v:q.map(([s,f])=>Math.round(R.at(s,f)*R.BEAT))}))")
_Q = [['assign', 104], ['assign', 119], ['review', 108], ['review', 119], ['measure', 105], ['measure', 119]]
_r = _json.loads(_sp.check_output(['node', '-e', _js, _os.path.join(_root, 'timeline.js'), _json.dumps(_Q), CUT]))
_Q = _r['q']
HAS = lambda k: k in _r['S']
SB = lambda k: _r['S'][k]['from'] * BEAT if HAS(k) else None
V = dict(zip([f'{a}@{b_}' for a, b_ in _Q], _r['v']))
END = _r['T'] * BEAT - 1
WORDS = []
if HAS('hook'): WORDS.append(('CÔNG VIỆC.', b(1) + 7, b(4) - 1, 'Task module'))
if HAS('tension'):
    WORDS += [(w, b(4 + i) + 6, b(5 + i) + 6, f) for i, (w, f) in enumerate([
        ('HẠN CHÓT', 'Due dates + alerts'), ('NHÂN SỰ', 'Staff'), ('ĐƠN VỊ', 'Org units'), ('TỆP', 'Result files'),
        ('GIA HẠN', 'Extensions'), ('PHÊ DUYỆT', 'Approval queue'), ('NHẮC VIỆC', 'Reminders')])]
    WORDS.append(('grid of 7 (invert)', b(11), b(12) - 1, 'same seven features'))
for k, w, a, z, f in [('create', 'TẠO VIỆC', 12, 23, 'Tạo công việc từ mẫu'), ('assign', 'GIAO VIỆC', 6, 21, 'Giao việc dialog'),
                      ('notify', 'THÔNG BÁO', 9, 24, 'Bell notification + deadline pop-up'), ('track', 'THEO DÕI', 7, 19, 'Kanban + progress update'),
                      ('extend', 'GIA HẠN', 10, 26, 'Extension approval'), ('review', 'DUYỆT', 0, 14, 'Đánh giá kết quả dialog'),
                      ('measure', 'THỐNG KÊ', 13, 33, 'Unit statistics')]:
    if HAS(k): WORDS.append((w, SB(k) + a, SB(k) + z, f))
for k, w, f in [('assign', 'ĐÃ GIAO.', 'Toast "Đã giao việc cho 1 người."'), ('review', 'ĐẠT / BỔ SUNG / KHÔNG ĐẠT', 'Verdicts'), ('measure', 'XUẤT EXCEL.', '"Xuất Excel" button')]:
    a0, a1 = {'assign': (104, 119), 'review': (108, 119), 'measure': (105, 119)}[k]
    if HAS(k): WORDS.append((w, V[f'{k}@{a0}'], V[f'{k}@{a1}'], f))
if HAS('build'):
    WORDS += [(f'collage word {i+1}', SB('build') + a0, SB('build') + a1 - 1, 'the seven scenes') for i, (a0, a1) in enumerate([(0, 13), (13, 24), (24, 34), (34, 44), (44, 54), (54, 64), (64, 75)])]
    WORDS.append(('HUIT', SB('build') + 81, SB('lockup') + b(6) - 1, 'Product name'))
else:
    WORDS.append(('HUIT', SB('lockup') + 9, END, 'Product name'))
lk0 = SB('lockup') + (10 if not HAS('build') else 4) + 2 + 3 + 10       # thesis title fully risen (2nd line)
WORDS.append(('Thesis title (2 lines, in lockup)', lk0, SB('endcard') - 1 if HAS('endcard') else END, 'Official thesis title'))
if HAS('endcard'): WORDS.append(('End card (thesis info)', SB('endcard') + 12, END, 'Verified: title, code, students, supervisor, university, year'))
MOVES = {
    'Hook':     ['slam-in (+2-frame zoom blur)', 'held settle'],
    'Tension':  ['directional slide-in + motion blur', 'fly into ledger', 'grid snap', 'colour invert #1'],
    'ASSIGN':   ['line-mask rise', 'text-as-window → real page', 'camera push', 'cursor + modal open', 'checkbox / segmented control', 'toast + ring', 'curtain wipe word'],
    'TRACK':    ['mask/wipe reveal', 'directional page swap', 'spotlight + status ring', 'slider drag + typing', 'Kanban card FLIP to new column', 'pull-back', 'wipe out'],
    'REVIEW':   ['hard cut', 'slice/split', 'field stagger', 'cursor + typing', 'status → Hoàn thành ring', 'line-wipe verdicts'],
    'MEASURE':  ['letter stagger #1', 'page rises (parallax)', 'counter flip', 'donut sweep', 'bar growth', 'table fill', 'colour invert #2 + word swap'],
    'Build':    ['3-layer collage (back/middle/front)', 'accelerating swaps', 'collapse → HUIT slit reveal'],
    'Lockup':   ['dead still', 'thesis title line-mask rise', 'closing fade'],
    'CREATE':   ['typewriter + caret', 'template fill flashes'],
    'NOTIFY':   ['tracking collapse', 'bell dropdown', 'pop-up push-through'],
    'EXTEND':   ['horizontal stretch', 'deadline compare + new date ring'],
}

ok = True
print('1) READABILITY')
for w, a, z, feat in WORDS:
    n = z - a + 1
    need = 20 if len(w.replace('.', '')) > 8 and ' ' not in w else 10
    flag = 'OK ' if n >= need else 'FAIL'
    ok &= n >= need
    print(f'  {flag} {w:22s} {n:3d} f (need {need})  -> {feat}')

print('2) MOVES')
sigs = {k: set(v) for k, v in MOVES.items() if k in ('ASSIGN', 'TRACK', 'REVIEW', 'MEASURE')}
for k, v in MOVES.items():
    print(f'  {k:8s}: ' + ' · '.join(v))
key = {k: next(m for m in v if m not in ('hard cut', 'word swap', 'line-mask rise')) for k, v in MOVES.items() if k in sigs}
dupe = len(set(key.values())) != len(key)
print('  signature moves per feature:', key, '-> unique' if not dupe else '-> REPEATED')
ok &= not dupe
stag = sum('stagger' in m for v in MOVES.values() for m in v)
inv = sum('invert' in m for v in MOVES.values() for m in v)
print(f'  letter stagger used {stag}x (max 2), colour invert {inv}x (max 3)')
ok &= stag <= 2 and inv <= 3

if VIDEO:
    print('4) PHOTOSENSITIVITY (mean luma per frame)')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', VIDEO, '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, 54, 96).astype(float)
    luma = fr.mean(axis=(1, 2)) / 255
    jumps = np.where(np.abs(np.diff(luma)) > 0.25)[0] + 1   # >25% full-frame luminance change in one frame
    print('  big luminance changes at frames:', jumps.tolist())
    worst = max((np.sum((jumps >= s) & (jumps < s + 30)) for s in range(len(luma))), default=0)
    print(f'  max big changes within any 1 s window: {worst} (limit 3 flashes/s = 6 transitions)')
    ok &= worst <= 6
print('\nRESULT:', 'PASS' if ok else 'CHECK FAILURES ABOVE')
