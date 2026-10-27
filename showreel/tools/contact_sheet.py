"""Contact sheet: one still per beat in a labelled grid.
usage: python3 tools/contact_sheet.py <stills_dir> <out.jpg> [cols] [--portrait]
"""
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 8
files = sorted(glob.glob(os.path.join(src, 'f*.png')))
import json as _j, subprocess as _s
_CUT = next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == '--cut'), os.environ.get('REEL_CUT', 'full'))
_S = _j.loads(_s.check_output(['node', '-e', "global.window={REEL_CUT:process.argv[2]};require('vm').runInThisContext(require('fs').readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(window.REEL.S))", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'timeline.js'), _CUT]))
SECTIONS = [(v['from'], v['to'], k.upper()) for k, v in _S.items()]
im0 = Image.open(files[0]); w0, h0 = im0.size
tw = 300 if w0 > h0 else 150
th = round(tw * h0 / w0)
lab = 22
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + 6) + 6, rows * (th + lab + 6) + 6), (40, 40, 40))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except Exception:
    font = ImageFont.load_default()
for i, f in enumerate(files):
    fr = int(os.path.basename(f)[1:5]); beat = fr // 15
    sec = next(n for a, z, n in SECTIONS if a <= beat < z) if beat < SECTIONS[-1][1] else ''
    x = 6 + (i % cols) * (tw + 6); y = 6 + (i // cols) * (th + lab + 6)
    sheet.paste(Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS), (x, y + lab))
    d.text((x + 2, y + 3), f'b{beat:02d} f{fr} {fr/30:.2f}s {sec}', fill=(230, 230, 230), font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
