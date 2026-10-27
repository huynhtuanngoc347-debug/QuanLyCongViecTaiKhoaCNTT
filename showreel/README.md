# HUIT — kinetic typography showreel (v5: thesis lockup, fixed echo slot, 30 s cut)

A 76 s showreel (30 fps, 1920×1080, 120 BPM grid) for the graduation thesis "Hệ thống quản lý công việc Khoa Công nghệ Thông tin". The bold kinetic type is unchanged from v1. The product scenes are new: **the app's real React UI** (frozen DOM states rendered with the app's own CSS) is animated with a camera, a cursor and state changes. See `STORYBOARD.md` for the beat-by-beat breakdown.

## v5 changes
- **Lockup:** "HUIT" and the official thesis title form one name block, so the frame reads as a thesis project rather than an official university product. A kicker line above it reads "Khóa luận tốt nghiệp cử nhân · CNTT-KLCN018".
- **End card:** filled from the approved thesis outline: title, topic code, the three students with student IDs, supervisor, university and year. Edit `THESIS` in `timeline.js` to change it.
- **THÔNG BÁO captions** name the users: "Phạm Thái Bảo nhận thông báo", "Lê Thị Mai: sắp đến hạn".
- **Echo numbers** (40 %, +9 NGÀY, 2 NGÀY, 1 → 2) use one fixed slot in every scene: bottom right, same size, on a black slab. This mirrors the step caption at top left.
- **30 s cut:** `--cut short` gives hook → GIAO VIỆC → THEO DÕI → DUYỆT → lockup (60 beats).

## v3 at a glance
- **Seven interaction scenes:**
  - TẠO VIỆC: create a task from a template;
  - GIAO VIỆC: assign it;
  - THÔNG BÁO: the assignee's bell notification and the deadline pop-up;
  - THEO DÕI: accept, report progress, the Kanban card moves;
  - GIA HẠN: approve an extension, and the "late" flag is cleared;
  - DUYỆT: review the result and mark it Đạt;
  - THỐNG KÊ: every earlier action shows up in the numbers.
- **Emphasis layer** (`emphasis()` in `reel.js`; tables `SPOT`, `ECHO`, and `CAPTIONS` in `timeline.js`):
  - a spotlight dims everything except the element being used;
  - numbered step captions (01, 02…) name each action;
  - a big type echo shows the value being changed (0 → 40 %, +9 NGÀY, 2 NGÀY).
- **Slow motion:** the four original scenes play their clicks, typing and state changes slower, using `WARP` in `timeline.js`. Audio cues follow the warp automatically.

## How the product scenes work
1. `tools/capture-states.mjs` drives the **real web app** (`apps/web`) against the mock API with Playwright. It clicks, types and submits exactly like a user, and freezes the rendered DOM of every step into `app/states/*.html`. Each state also gets a `.ref.png` screenshot for alignment checks. All 18 states come from real interactions:
   - **Assign task 103:** Phạm Thái Bảo, Chủ trì role.
   - **Assignee:** Lê Thị Mai accepts and reports 40 %.
   - **Review:** task 104's result is marked Đạt.
   - **Statistics:** the stats page is captured before and after.
2. `reel.js` loads those states into iframes (`#ui` layer) and, frame by frame:
   - moves a camera (push-ins and pull-backs);
   - draws the pointer and click rings;
   - opens and closes the real `<dialog>`s;
   - ticks real checkboxes, segmented controls and range inputs;
   - types into the real textareas;
   - slides in the real toasts;
   - FLIP-animates the Kanban card into its new column;
   - grows the real chart elements: SVG donut, bar heights, KPI counters.

   It never invents a status: every after-state is the app's own output.
3. **Mock patches (`tools/mock-api-showreel.mjs`):** this is a copy of `tools/mock-api.mjs` with two patches that make the mock match the real API (`apps/api/src/tasks/task.commands.ts`, `stats.queries.ts`):
   - approving the last open assignment as Đạt auto-closes the task as **Hoàn thành**;
   - the unit statistics are computed from the demo tasks instead of fixed numbers.

## Files
| Path | What |
|---|---|
| `timeline.js` | **Central config**: FPS, BPM, sections (in beats), VI/EN copy, thesis info, palette, audio cue slots |
| `reel.js`, `index.html`, `fonts.css` | Frame-deterministic renderer: `renderFrame(f)`, layers `#under` / `#ui` / `#over` / `#cursor` |
| `app/` | The app's own CSS, fonts and icons, plus `states/*.html` (frozen real UI) and `*.ref.png` |
| `tools/capture-states.mjs` | Re-capture the UI states from the real app (needs the mock API running) |
| `tools/mock-api-showreel.mjs` | Patched mock (copy into the repo's `tools/` to run, since it serves `apps/web/dist`) |
| `tools/render.mjs` | Render MP4 or stills (local HTTP server → Playwright Chromium → ffmpeg) |
| `tools/contact_sheet.py`, `tools/check.py` | One still per beat; readability, move, mapping and flash-rate checks |
| `tools/mux.mjs` | Music + SFX on the beat grid (optional) |

## Render (exact commands)
```bash
cd showreel
npm i playwright                     # once (or use a global Playwright); ffmpeg must be on PATH
node tools/render.mjs --lang vi --out out/HUIT_showreel_16x9_VI.mp4      # main version (~5 min)
python3 tools/compose_audio.py && node tools/mux.mjs out/HUIT_showreel_16x9_VI.mp4 --score   # → *_audio.mp4
node tools/render.mjs --lang en --out out/HUIT_showreel_16x9_EN.mp4
# 30 s cut (same source, own timeline; audio and checks take the same flag)
node tools/render.mjs --lang vi --cut short --out out/HUIT_short30_16x9_VI.mp4
python3 tools/compose_audio.py --cut short && node tools/mux.mjs out/HUIT_short30_16x9_VI.mp4 --score --cut short
python3 tools/check.py out/HUIT_short30_16x9_VI.mp4 --cut short
node tools/render.mjs --lang vi --stills beats --dir out/beats && python3 tools/contact_sheet.py out/beats out/contact_sheet_16x9_VI.jpg 8
python3 tools/check.py out/HUIT_showreel_16x9_VI.mp4
```
- **Preview one frame:** run `node tools/render.mjs --stills 250 --dir out/test`. Opening `index.html` straight from disk won't work, because the iframes need same-origin HTTP.
- **Render part of the film:** add `--from 180 --to 420`.
- **Re-capture after a UI change:** start the patched mock (`node tools/mock-api-showreel.mjs`, fresh data), then run `node tools/capture-states.mjs`.

**End card:** only verified facts are shown, taken from the thesis outline (CNTT-KLCN018) and the app's login page. Empty fields in `THESIS` are not drawn. The supervisor's academic title (ThS./TS.) is not in the outline; add it exactly as on the report cover. A small line states "real UI · sample data, simulated interactions".

**9:16:** the type layer still adapts, but the v2 UI camera moves are framed for 16:9. A vertical cut needs its own camera keys.

## Audio
**Built-in original score:** run `python3 tools/compose_audio.py`. It synthesises the music and every UI sound effect from the cues in `timeline.js`, with no samples and no third-party rights involved. Output: `audio/score_mix.wav`, plus the stems `score_music.wav` and `score_sfx.wav`.
Then run `node tools/mux.mjs out/HUIT_showreel_16x9_VI.mp4 --score` to get `out/HUIT_showreel_16x9_VI_audio.mp4`, at about -14 LUFS with true peak ≤ -1 dBTP.

**Or use your own audio:** Put royalty-free files in `audio/` (`music.mp3|wav`, `hit.wav`, `tick.wav`, `whoosh.wav`, `click.wav`, `riser.wav`) and run `node tools/mux.mjs out/<video>.mp4`. Cue beats are in `REEL.AUDIO`; there are click cues on every simulated click. If the track is not 120 BPM, set `BPM` in `timeline.js`.

| Slot | Title / author | Source URL | Licence |
|---|---|---|---|
| Music | Original score — tools/compose_audio.py | generated | no third-party rights |
| SFX | Original, synthesised in tools/compose_audio.py | generated | no third-party rights |

## Credits
- Typeface: Be Vietnam Pro, © The Be Vietnam Pro Project Authors, SIL Open Font License 1.1.
- UI: the app's own CSS and Inter font (SIL OFL 1.1); demo data from the mock API.
