"""Original score + sound design for the HUIT showreel — synthesised from scratch.

Nothing is sampled or downloaded: every sound is generated here (numpy/scipy), so the
result is free of third-party rights. Timing comes from timeline.js (REEL.S, REEL.AUDIO),
so the music and every UI click stay locked to the picture if the timeline changes.

    python3 tools/compose_audio.py            -> audio/score_music.wav, audio/score_sfx.wav, audio/score_mix.wav
    then: node tools/mux.mjs out/HUIT_showreel_16x9_VI.mp4 --score   (or see README)

Style: 120 BPM, D minor, minimal tech-house pulse — punchy kick, tight hats, short bass,
airy pad; restrained UI foley (clicks, typing, slider detents, toast chime).
"""
import json, os, subprocess, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
rng = np.random.default_rng(7)                      # deterministic: same score every run

# ---------------------------------------------------------------- timeline
CUT = next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == '--cut'), os.environ.get('REEL_CUT', 'full'))
SUF = '' if CUT == 'full' else '_' + CUT                # audio/score_mix_short.wav for the 30 s cut
js = "global.window={REEL_CUT:process.argv[2]};require('vm').runInThisContext(require('fs').readFileSync(process.argv[1],'utf8'));" \
     "const R=window.REEL;console.log(JSON.stringify({BPM:R.BPM,FPS:R.FPS,S:R.S,TOTAL:R.TOTAL_BEATS,AUDIO:R.AUDIO}))"
R = json.loads(subprocess.check_output(['node', '-e', js, os.path.join(ROOT, 'timeline.js'), CUT]))
SPB = 60.0 / R['BPM']                               # seconds per beat
DUR = R['TOTAL'] * SPB
N = int(DUR * SR) + SR * 2                          # + tail
S = {k: (v['from'], v['to']) for k, v in R['S'].items()}
t_of = lambda beat: beat * SPB

music = np.zeros((N, 2))
sfx = np.zeros((N, 2))

def add(buf, x, at, gain=1.0, pan=0.0):
    """mix mono/stereo x into buf at time `at` (s) with constant-power pan"""
    i = int(round(at * SR))
    if i >= len(buf): return
    if x.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        x = np.stack([x * l * 1.414, x * r * 1.414], 1)
    n = min(len(x), len(buf) - i)
    if i < 0: x, n, i = x[-i:], n + i, 0
    buf[i:i + n] += x[:n] * gain

# ---------------------------------------------------------------- DSP helpers
T = lambda d: np.arange(int(d * SR)) / SR
def env_exp(d, tau): return np.exp(-T(d) / tau)
def env_adsr(d, a, r):
    t = T(d); e = np.minimum(1, t / max(a, 1e-4)); rel = np.clip((d - t) / max(r, 1e-4), 0, 1)
    return e * rel
def bp(x, lo, hi, order=2): return signal.sosfilt(signal.butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)
def lp(x, f, order=2): return signal.sosfilt(signal.butter(order, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return signal.sosfilt(signal.butter(order, f, 'high', fs=SR, output='sos'), x)
def noise(d): return rng.standard_normal(int(d * SR))
def saw(freq, d, detune=0.0):
    t = T(d); ph = (freq * (1 + detune)) * t
    return 2 * (ph - np.floor(ph + 0.5))
def sweep_filter(x, f0, f1, kind='band', q=0.25, block=256):
    """time-varying filter (block-wise) — frequency glides f0 → f1 (exponential)"""
    out = np.zeros_like(x); zi = None
    nb = int(np.ceil(len(x) / block))
    for b in range(nb):
        f = f0 * (f1 / f0) ** (b / max(1, nb - 1))
        if kind == 'band': sos = signal.butter(2, [max(30, f * (1 - q)), min(SR / 2 - 100, f * (1 + q))], 'band', fs=SR, output='sos')
        else: sos = signal.butter(2, min(SR / 2 - 100, f), 'low', fs=SR, output='sos')
        if zi is None: zi = np.zeros((sos.shape[0], 2))
        seg = x[b * block:(b + 1) * block]
        y, zi = signal.sosfilt(sos, seg, zi=zi)
        out[b * block:b * block + len(seg)] = y
    return out
def reverb_ir(d=2.2, damp=4000):
    ir = noise(d) * env_exp(d, d / 6.5)
    l, r = lp(ir, damp), lp(np.roll(ir, 997), damp)
    st = np.stack([l, r], 1); st[0] = 0
    return st / np.sqrt((st ** 2).sum())
IR = reverb_ir()
def reverb(x, wet=0.25):
    if x.ndim == 1: x = np.stack([x, x], 1)
    y = np.stack([signal.fftconvolve(x[:, c], IR[:, c])[:len(x) + len(IR)] for c in range(2)], 1)
    dry = np.zeros_like(y); dry[:len(x)] = x
    return dry * (1 - wet) + y * wet * 3
midi = lambda n: 440 * 2 ** ((n - 69) / 12)

# ---------------------------------------------------------------- instruments
def kick(level=1.0):
    d = 0.42; t = T(d)
    f = 45 + 110 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(d, 0.16)
    click = hp(noise(0.006), 2500) * np.linspace(1, 0, int(0.006 * SR)) * 0.5
    body[:len(click)] += click
    return np.tanh(body * 1.6) * 0.9 * level
def clap():
    d = 0.22; x = bp(noise(d), 900, 2600) * env_exp(d, 0.05)
    for k in (0.012, 0.024): x[int(k * SR):] += bp(noise(d - k), 900, 2600) * env_exp(d - k, 0.03) * 0.6
    return x * 0.55
def hat(open_=False):
    d = 0.18 if open_ else 0.045
    return hp(noise(d), 7500, 4) * env_exp(d, 0.06 if open_ else 0.012) * (0.22 if open_ else 0.16)
def bass(note, d):
    x = saw(midi(note), d) + 0.5 * saw(midi(note - 12), d)
    x = lp(x, 520) * env_adsr(d, 0.004, 0.06)
    return np.tanh(x * 1.4) * 0.42
def pad(notes, d, bright=1800):
    x = sum(saw(midi(n), d, dt) for n in notes for dt in (-0.004, 0.0, 0.0045))
    x = lp(x / (len(notes) * 3), bright, 2) * env_adsr(d, 0.35, 0.6)
    return x * 0.5
def hit(level=1.0):
    d = 1.6; t = T(d)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 70 * np.exp(-t / 0.06)) / SR) * env_exp(d, 0.45)
    burst = bp(noise(d), 150, 6000) * env_exp(d, 0.07) * 0.7
    metal = bp(noise(d), 3000, 9000) * env_exp(d, 0.35) * 0.12
    return reverb(np.tanh((sub + burst + metal) * 1.3) * 0.85 * level, 0.3)
def tick():
    d = 0.09; t = T(d)
    x = np.sin(2 * np.pi * 1760 * t) * env_exp(d, 0.012) + bp(noise(d), 2000, 6000) * env_exp(d, 0.006) * 0.4
    return x * 0.32
def click():                                        # mouse / trackpad click — dry, short, quiet
    d = 0.035; t = T(d)
    x = bp(noise(d), 2500, 9000) * env_exp(d, 0.0025) + np.sin(2 * np.pi * 3100 * t) * env_exp(d, 0.004) * 0.35
    return x * 0.5
def key():                                          # one keystroke
    d = 0.04; f = rng.uniform(2200, 3600)
    return bp(noise(d), f * 0.6, f * 1.4) * env_exp(d, 0.004) * rng.uniform(0.18, 0.28)
def detent():
    d = 0.02; return bp(noise(d), 4000, 9000) * env_exp(d, 0.002) * 0.16
def toast():                                        # soft two-note confirmation (D6 → A6)
    d = 0.5; t = T(d)
    a = np.sin(2 * np.pi * midi(86) * t) * env_exp(d, 0.12)
    b = np.zeros_like(a); k = int(0.07 * SR)
    b[k:] = np.sin(2 * np.pi * midi(93) * t[:-k]) * env_exp(d - k / SR, 0.18)[:len(b) - k]
    return reverb((a * 0.6 + b) * 0.16, 0.25)
def chime():                                        # counters flip — brighter triad
    d = 0.9; t = T(d)
    x = sum(np.sin(2 * np.pi * midi(n) * t) * env_exp(d, 0.25) / (i + 1) ** 0.3 for i, n in enumerate((86, 89, 93, 98)))
    return reverb(x * 0.09, 0.35)
def whoosh(d=0.42, up=True, level=1.0):
    x = noise(d) * np.sin(np.pi * np.clip(T(d) / d, 0, 1)) ** 1.5
    x = sweep_filter(x, 500 if up else 5000, 5000 if up else 500, 'band', 0.45)
    return reverb(x * 0.55 * level, 0.2)
def open_():                                        # dialog appears — short airy swell
    return whoosh(0.22, True, 0.45)
def move(d):                                        # card flight + soft landing
    x = whoosh(d, True, 0.5)
    land = lp(noise(0.08), 900) * env_exp(0.08, 0.02) * 0.5
    y = np.zeros((len(x) + len(land), 2)); y[:len(x)] += x; y[int(d * SR) - 600:int(d * SR) - 600 + len(land)] += land[:, None]
    return y
def riser(d):
    t = T(d)
    nz = sweep_filter(noise(d), 300, 9000, 'band', 0.35) * (t / d) ** 2 * 0.7
    f = 110 * 2 ** (3 * t / d)
    sw = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / d) ** 2 * 0.18
    return reverb(nz + sw, 0.25)
def alert():                                        # deadline pop-up — soft, slightly urgent three-note figure
    d = 0.9; out = np.zeros(int(d * SR))
    for i, n in enumerate((81, 84, 88)):
        k = int(i * 0.09 * SR); t = T(d - i * 0.09)
        out[k:k + len(t)] += np.sin(2 * np.pi * midi(n) * t) * env_exp(d - i * 0.09, 0.16) * (0.8 + 0.1 * i)
    return reverb(out * 0.13, 0.3)
def stretch(d=0.45):                                # word stretches — rising filtered tone
    t = T(d); f = 180 * 2 ** (2.2 * t / d)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / d) * 0.22
    return reverb(x + sweep_filter(noise(d), 400, 4000, 'band', 0.3) * np.sin(np.pi * t / d) * 0.25, 0.2)
def snare():
    d = 0.18; x = bp(noise(d), 1200, 7000) * env_exp(d, 0.04) + np.sin(2 * np.pi * 190 * T(d)) * env_exp(d, 0.03) * 0.5
    return x * 0.38

# ---------------------------------------------------------------- music (arrangement)
CHORDS = [(50, [62, 65, 69, 74]), (46, [58, 62, 65, 70]), (41, [57, 60, 65, 69]), (48, [55, 60, 64, 67])]   # Dm Bb F C
beat_t = lambda b: b * SPB
FEAT = [k for k in ('create', 'assign', 'notify', 'track', 'extend', 'review', 'measure') if k in S]
groove_from, groove_to = S[FEAT[0]][0], S[FEAT[-1]][1]                  # all interaction scenes in this cut

# hook: silence, slam (hit is an SFX cue), low drone tail
add(music, pad([38, 45, 50], 3 * SPB, 600), beat_t(1), 0.5)
# tension 4–12: kick on the beat, closed hats, bass root pulses, filter opening
if 'tension' in S:
    for b in range(4, 11):
        add(music, kick(0.9), beat_t(b))
        add(music, bass(38, SPB * 0.45), beat_t(b), 0.8)
        for s in range(4): add(music, hat(), beat_t(b + s / 4), 0.6 + 0.3 * (s == 2), pan=0.25)
    add(music, pad([50, 57, 62, 65], 7 * SPB, 900), beat_t(4), 0.35)
# grid snap at 11: stop + breath
# features 12–44: full groove, slightly under the UI foley
for b in range(groove_from, groove_to):
    bar, pos = divmod(b - groove_from, 4)
    root, chord = CHORDS[bar % 4]
    add(music, kick(), beat_t(b), 0.95)
    if pos in (1, 3): add(music, clap(), beat_t(b), 0.7, pan=-0.05)
    add(music, hat(True), beat_t(b + 0.5), 0.8, pan=0.3)
    for s in (0.25, 0.75): add(music, hat(), beat_t(b + s), 0.7, pan=-0.3)
    for s, n in ((0, root - 12), (0.5, root), (0.75, root - 12)):
        add(music, bass(n, SPB * 0.22), beat_t(b + s), 0.75)
    if pos == 0: add(music, pad(chord, 4 * SPB, 1600), beat_t(b), 0.32)
for sec in FEAT:                       # crash-ish air on each feature downbeat
    add(music, reverb(hp(noise(1.2), 5000) * env_exp(1.2, 0.35) * 0.18, 0.4), beat_t(S[sec][0]), 0.8)
# build 44–50: kick to 48, accelerating snare roll, chords held
if 'build' in S:
    b0, b1 = S['build']
    for b in range(b0, b1 - 2): add(music, kick(), beat_t(b), 0.95)
    rolls = [(b0, b0 + 2, 1), (b0 + 2, b0 + 3.5, 2), (b0 + 3.5, b0 + 4.5, 4), (b0 + 4.5, b0 + 5, 8)]
    for a, z, per in rolls:
        k = a
        while k < z - 1e-6:
            add(music, snare(), beat_t(k), 0.4 + 0.6 * (k - b0) / 5); k += 1 / per
    add(music, pad([50, 57, 62, 65, 69], 5 * SPB, 1200), beat_t(b0), 0.3)

# lockup 50–56: one sustained chord (Dm add9) with long reverb, then the end card fades out
lk = S['lockup'][0]
add(music, reverb(pad([38, 50, 57, 64, 65, 69], 10 * SPB, 1400), 0.45), beat_t(lk), 0.55)
if 'endcard' in S: add(music, reverb(np.sin(2 * np.pi * midi(81) * T(3)) * env_exp(3, 0.8) * 0.05, 0.5), beat_t(S['endcard'][0]), 1.0)

# ---------------------------------------------------------------- SFX from the cue list
for c in R['AUDIO']:
    at, k, span = t_of(c['beat']), c['sfx'], c.get('span', 0) * SPB
    if k == 'hit': add(sfx, hit(), at - 0.005, 0.95)
    elif k == 'tick': add(sfx, tick(), at, 1.0, pan=rng.uniform(-0.3, 0.3))
    elif k == 'click': add(sfx, click(), at, 1.9, pan=0.15)
    elif k == 'open': add(sfx, open_(), at, 1.4)
    elif k == 'toast': add(sfx, toast(), at, 1.7)
    elif k == 'chime': add(sfx, chime(), at, 1.6)
    elif k == 'alert': add(sfx, alert(), at, 1.6)
    elif k == 'stretch': add(sfx, stretch(), at, 1.0)
    elif k == 'type':                                                          # typewriter word: one key per character
        for i in range(int(span * 26)): add(sfx, key(), at + i * 1.5 / 30, 1.9, pan=rng.uniform(-0.15, 0.15))
    elif k == 'whoosh': add(sfx, whoosh(), at - 0.08, 0.8)
    elif k == 'move': add(sfx, move(span), at, 1.0)
    elif k == 'riser': add(sfx, riser(span), at, 0.9)
    elif k == 'typing':
        n = int(span * 26)                                                     # ~26 keys/s
        for i in range(n): add(sfx, key(), at + i / 26 + rng.uniform(-0.008, 0.008), 1.6, pan=rng.uniform(-0.2, 0.2))
    elif k == 'detents':
        for i in range(8): add(sfx, detent(), at + span * (i + 1) / 8, 1.8, pan=0.2)

# ---------------------------------------------------------------- mix + master
# sidechain-ish duck: music dips briefly under every hit and under UI foley
duck = np.ones(N)
for c in R['AUDIO']:
    i = int(t_of(c['beat']) * SR)
    depth, d = (0.55, 0.5) if c['sfx'] == 'hit' else (0.85, 0.18) if c['sfx'] in ('click', 'toast', 'open', 'chime') else (1, 0)
    if depth < 1:
        L = int(d * SR); seg = 1 - (1 - depth) * np.exp(-np.arange(L) / (L / 4))
        duck[i:i + L] = np.minimum(duck[i:i + L], seg[:len(duck[i:i + L])])
duck = signal.sosfilt(signal.butter(1, 30, 'low', fs=SR, output='sos'), duck)
music *= duck[:, None] * 0.8
end = int(DUR * SR); fade = int(2.5 * SR)
for buf in (music, sfx):
    buf[end - fade:end] *= np.linspace(1, 0, fade)[:, None] ** 2
    buf[end:] = 0
mix = music + sfx
mix = np.stack([hp(mix[:, c], 28) for c in range(2)], 1)
mix = np.tanh(mix * 1.15) / np.tanh(1.15)                                       # gentle glue / soft clip
peak = np.max(np.abs(mix)); mix *= 0.89 / peak                                  # ~ -1 dBFS sample peak

out = os.path.join(ROOT, 'audio'); os.makedirs(out, exist_ok=True)
for name, buf in (('score_music', music / max(1e-9, np.max(np.abs(music))) * 0.89), ('score_sfx', sfx / max(1e-9, np.max(np.abs(sfx))) * 0.89), ('score_mix', mix)):
    wavfile.write(os.path.join(out, name + SUF + '.wav'), SR, buf[:end].astype(np.float32))
print(f'wrote audio/score_music{SUF}.wav, audio/score_sfx{SUF}.wav, audio/score_mix{SUF}.wav', f'{DUR:.1f}s')
