# HUIT showreel v2 — storyboard

1920×1080 · 30 fps · 960 frames = 32.0 s · 120 BPM (beat = 15 f, bar = 60 f). All timings are in beats in `timeline.js`.
Type: Be Vietnam Pro 900/500. Palette: #0b0b0c · #f1efea · accent #2563eb (the app's `--blue`). The UI is the real app (frozen DOM states).

**Why the film is longer (22 s → 32 s):** in v1 each feature had 2 s and the UI was on screen for about 1 s. That is not enough for "reveal → camera → cursor → action → result". Each feature now gets 2 bars (4 s). The opening and the collage keep their v1 pacing, and the end card is held for 4 s so it can be read.

| Section | Beats (s) | What happens | Real UI state(s) |
|---|---|---|---|
| Hook | 0–4 (0–2) | Black → **CÔNG VIỆC.** slams in (1.4→1, zoom blur), then a held, barely-moving settle | — |
| Tension | 4–12 (2–6) | One dominant word per beat, entering from alternating sides with directional motion blur. Each replaced word flies up into a quiet numbered ledger along the top (no pile of overlaps). Beat 11: grid snap + invert #1 | — |
| GIAO VIỆC | 12–20 (6–10) | Word rises through a line mask. The **letters become a window** onto the task page "Cập nhật chương trình đào tạo CNTT 2026", then the window opens to full frame. Camera → "+ Giao việc", cursor click → the real dialog opens. Push-in on recipients: tick **Phạm Thái Bảo (0 việc đang mở)**, role **Chủ trì**, click "Giao việc". Dialog closes, the real toast **"Đã giao việc cho 1 người."** appears, and a ring marks "Phân công 3 người / đơn vị". **ĐÃ GIAO.** rides in on a black curtain that wipes the UI away | A0 → A1 (+ live checkbox, segmented control) → A3 |
| THEO DÕI | 20–28 (10–14) | Accent-bar wipe reveal. The word exits left with blur as the **manager's Kanban** slides in. Spotlight on the task in "Chưa bắt đầu" with a ring on the status. Directional swap to the assignee's view: **Tiếp nhận** → toast "Đã tiếp nhận việc.", chip "Chờ tiếp nhận → Đã tiếp nhận". **Cập nhật tiến độ** dialog: slider dragged 0 → 40 % (5 % steps), note typed, "Cập nhật". Back on the board, the **card moves to "Đang thực hiện"** (FLIP) while its bar fills to 40 %. Pull back to the whole board, then accent wipe out | T0 → T1 → T2 → T3 → T0 (FLIP) → T5 |
| DUYỆT | 28–36 (14–18) | Hard cut. The word is **sliced** and its halves part over the result tab. Click "Đánh giá" → the dialog opens and its **fields reveal in sequence**. "Đạt" pressed, comment typed, "Lưu đánh giá". Real result: toast "Đã duyệt: Đạt.", result chip **Đạt**, task status **Hoàn thành** (ring), Tiến độ 99 → 100 %. The UI dims as **ĐẠT / BỔ SUNG / KHÔNG ĐẠT** wipe in line by line | R0 → R1 (+ typing) → R2 |
| THỐNG KÊ | 36–44 (18–22) | Letter stagger. The word lifts away (parallax) as the **statistics page rises**. KPI cards stagger in and count up to the **before** values, then flip to the **after** values (Hoàn thành 1 → 2, Đánh giá Đạt 1 → 2), ringed: the task just approved. The donut sweeps (40 %), legend rows stagger, monthly bars grow, the unit table fills. Pull back, cursor presses "Xuất Excel" (no fake download UI). Invert #2: **XUẤT EXCEL.** | S_before (values) + S1 |
| Collage | 44–50 (22–25) | Three layers: giant low-contrast rows (back), secondary feature words drifting the other way (middle), one dominant keyword (front) swapping at 15 → 10 f intervals. Everything collapses to a line that opens into **HUIT** | — |
| Lockup | 50–56 (25–28) | HUIT dead still; tagline, then "Không việc nào bị bỏ sót." | — |
| End card | 56–64 (28–32) | Verified only: thesis type, title, Khoa Công nghệ Thông tin · Trường Đại học Công Thương Thành phố Hồ Chí Minh · 2026. Student/supervisor appear once filled in. Footnote: real UI, sample data, simulated interactions | — |

**Honesty rules followed**
- Every status, count and toast shown is what the real app rendered after a real action on demo data.
- The mock was patched only where it differed from the real API (auto-close on Đạt, computed statistics).
- Nothing claims the production database changes.
