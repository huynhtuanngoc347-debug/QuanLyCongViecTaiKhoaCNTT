// ============================================================================
// HUIT — kinetic type showreel: CENTRAL TIMELINE CONFIG
// Every cue is expressed in BEATS on the music grid. Change BPM here and the
// whole film re-times itself (cuts stay on beat). Frames are derived, never typed.
// ============================================================================
window.REEL = (() => {
  const FPS = 30;
  const BPM = 120;                    // 120 BPM -> 1 beat = 15 f, 1 bar = 60 f
  const BEAT = (FPS * 60) / BPM;      // frames per beat
  const b = (beats) => Math.round(beats * BEAT); // beat -> frame (half beats allowed: 2.5)

  // Section boundaries (in beats). 104 beats = 26 bars = 52.0 s @ 120 BPM.
  // v3: seven interaction scenes. The four core features get 3 bars (6 s) each and
  // play their key interactions in slow motion; three new 2-bar scenes add
  // creating from a template, notifications + deadline pop-up, and extension approval.
  // v4: every interaction scene plays at roughly half speed (see SLOW below) so each
  // click, state change and confirmation can be read; type intros/outros stay 1×.
  // CUT: 'full' (76 s, every scene) or 'short' (30 s: the task lifecycle giao → theo dõi → duyệt).
  // Browser: index.html?cut=short · Node tools: REEL_CUT=short (env) or --cut short.
  const CUT = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('cut')) || window.REEL_CUT || 'full';
  const LENS = {
    full:  { hook: 4, tension: 8, create: 14, assign: 20, notify: 14, track: 20, extend: 14, review: 20, measure: 18, build: 6, lockup: 6, endcard: 8 },
    // short: the three core interaction scenes, each at ~1.3× v3 speed (v4 is ~1.7×); the lockup
    // carries the thesis title, so the film still says what it is without the end card.
    short: { hook: 4, assign: 16, track: 16, review: 16, lockup: 8 },
  };
  const LEN = LENS[CUT] || LENS.full;
  const S = {}; let acc = 0;
  for (const [k, n] of Object.entries(LEN)) { S[k] = { from: acc, to: acc + n }; acc += n; }
  const TOTAL_BEATS = acc;                                                      // full: 152 beats = 76 s · short: 60 beats = 30 s

  // ---- TIME WARP (slow motion on the interactions) ---------------------------
  // The four core scenes were choreographed on a 120-frame clock ("action time").
  // Each section is now 180 frames; [[sectionFrame, actionFrame], …] stretches the
  // moments that matter (clicks, typing, state changes) and keeps the type beats at 1×.
  const WARP = {
    assign:  [[0, 0], [30, 30], [50, 44], [68, 60], [93, 70], [115, 80], [131, 88], [150, 100], [180, 120]],
    track:   [[0, 0], [17, 17], [34, 30], [44, 40], [56, 45], [74, 54], [84, 58], [96, 65], [121, 75], [140, 88], [146, 92], [168, 108], [180, 120]],
    review:  [[0, 0], [30, 30], [42, 36], [60, 48], [78, 54], [96, 68], [106, 72], [140, 92], [156, 100], [180, 120]],
    measure: [[0, 0], [24, 24], [40, 40], [66, 52], [90, 72], [110, 92], [140, 104], [155, 105], [180, 120]],
  };
  const lin = (keys, x, a, z) => { for (let i = 0; i < keys.length - 1; i++) { const k0 = keys[i], k1 = keys[i + 1]; if (x <= k1[a] || i === keys.length - 2) return k0[z] + (k1[z] - k0[z]) * (x - k0[a]) / (k1[a] - k0[a]); } return x; };
  // SLOW: outer stretch on top of WARP. [intro, outro, length before stretching] in v3 section frames:
  // the intro (big word) and outro (type hand-off) keep their speed, everything between is stretched
  // to fill the scene's new length (≈ 1.7–2× slower than v3).
  const SLOW = {
    create: [22, 12, 120], assign: [30, 30, 180], notify: [22, 16, 120], track: [17, 12, 180],
    extend: [24, 12, 120], review: [30, 24, 180], measure: [24, 25, 180],
  };
  const outerKeys = (sec) => {
    const [i, o, n] = SLOW[sec], m = (S[sec].to - S[sec].from) * BEAT;   // m = this cut's section length
    return [[0, 0], [i, i], [m - o, n - o], [m, n]];
  };
  const toAction = (sec, f) => { const v = SLOW[sec] && S[sec] ? lin(outerKeys(sec), f, 0, 1) : f; return WARP[sec] ? lin(WARP[sec], v, 0, 1) : v; };   // section → action
  const toSection = (sec, f) => { const v = WARP[sec] ? lin(WARP[sec], f, 1, 0) : f; return SLOW[sec] && S[sec] ? lin(outerKeys(sec), v, 1, 0) : v; }; // action → section
  const WARPED = (sec) => !!(SLOW[sec] || WARP[sec]);
  const at = (sec, f) => (S[sec].from * BEAT + toSection(sec, f)) / BEAT;      // → absolute beat

  // ---- STEP CAPTIONS: [action frame, vi, en] — numbered, shown until the next one
  // (the last one ends at its `end` frame). They name what the cursor is doing.
  const CAPTIONS = {
    create:  { end: 108, steps: [[34, 'Tạo từ mẫu', 'Start from a template'], [50, 'Chọn mẫu', 'Pick the template'], [64, 'Mẫu tự điền', 'Fields fill in'], [84, 'Tạo công việc', 'Create the task']] },
    assign:  { end: 100, steps: [[36, 'Mở giao việc', 'Open assign'], [61, 'Chọn người nhận', 'Choose the assignee'], [74, 'Vai trò: Chủ trì', 'Role: lead'], [85, 'Xác nhận', 'Confirm']] },
    notify:  { end: 104, steps: [[30, 'Phạm Thái Bảo nhận thông báo', 'Phạm Thái Bảo is notified'], [64, 'Lê Thị Mai: sắp đến hạn', 'Lê Thị Mai: deadline alert'], [88, 'Lê Thị Mai mở việc cần làm', 'Lê Thị Mai opens the task']] },
    track:   { end: 108, steps: [[24, 'Việc chưa bắt đầu', 'Not started yet'], [37, 'Tiếp nhận', 'Accept'], [57, 'Báo tiến độ', 'Report progress'], [76, 'Ghi lại đã làm gì', 'Note what was done'], [95, 'Tự chuyển cột', 'Card moves column']] },
    extend:  { end: 110, steps: [[26, 'Yêu cầu gia hạn', 'Extension request'], [46, 'So sánh hạn', 'Compare deadlines'], [60, 'Đồng ý', 'Approve'], [88, 'Hạn mới đã cập nhật', 'New deadline applied']] },
    review:  { end: 92, steps: [[36, 'Mở kết quả', 'Open the result'], [49, 'Quyết định: Đạt', 'Decision: pass'], [56, 'Ghi nhận xét', 'Add a comment'], [76, 'Hoàn thành 100%', 'Done · 100%']] },
    measure: { end: 104, steps: [[46, 'Số liệu tự cập nhật', 'Numbers update'], [56, 'Theo trạng thái', 'By status'], [66, 'Theo tháng', 'By month'], [78, 'Theo đơn vị', 'By unit'], [96, 'Xuất Excel', 'Export to Excel']] },
  };

  // ---- COPY ---------------------------------------------------------------
  // Each big word maps to a real feature of the app (see STORYBOARD.md).
  const COPY = {
    vi: {
      hook: 'CÔNG VIỆC',
      tension: ['HẠN CHÓT', 'NHÂN SỰ', 'ĐƠN VỊ', 'TỆP', 'GIA HẠN', 'PHÊ DUYỆT', 'NHẮC VIỆC'],
      create: 'TẠO VIỆC', notify: 'THÔNG BÁO', extend: 'GIA HẠN',
      assign: 'GIAO VIỆC', assignDone: 'ĐÃ GIAO.',
      track: 'THEO DÕI',
      review: 'DUYỆT',     reviewSwap: ['ĐẠT', 'BỔ SUNG', 'KHÔNG ĐẠT'],
      measure: 'THỐNG KÊ', measureSwap: 'XUẤT EXCEL.',
      marquee: ['TẠO VIỆC', 'GIAO VIỆC', 'THÔNG BÁO', 'THEO DÕI', 'GIA HẠN', 'DUYỆT', 'THỐNG KÊ'],
      echo: { days: 'NGÀY' },
      secondary: ['TIẾP NHẬN', 'TIẾN ĐỘ', 'NHẮC VIỆC', 'GIA HẠN', 'KẾT QUẢ', 'HẠN CHÓT'],
      product: ['HU', 'IT'],
      tagline: 'Hệ thống quản lý công việc Khoa Công nghệ Thông tin',
      closing: 'Không việc nào bị bỏ sót.',
      end: {
        kind: 'Khóa luận tốt nghiệp cử nhân',
        title: 'Xây dựng ứng dụng quản lý công việc tại Khoa Công nghệ Thông tin',   // official title (đề cương CNTT-KLCN018), "Khoa CNTT" written out
        titleLines: ['Xây dựng ứng dụng quản lý công việc', 'tại Khoa Công nghệ Thông tin'],
        studentLabel: 'Sinh viên thực hiện', supervisorLabel: 'Giảng viên hướng dẫn',
        faculty: 'Khoa Công nghệ Thông tin',
        demo: 'Giao diện thật của ứng dụng · dữ liệu mẫu, thao tác mô phỏng',
      },
    },
    en: {
      hook: 'TASKS',
      tension: ['DEADLINES', 'PEOPLE', 'UNITS', 'FILES', 'EXTENSIONS', 'APPROVALS', 'REMINDERS'],
      create: 'CREATE', notify: 'NOTIFY', extend: 'EXTEND',
      assign: 'ASSIGN',  assignDone: 'ASSIGNED.',
      track: 'TRACK',
      review: 'REVIEW',  reviewSwap: ['PASS', 'REVISE', 'FAIL'],
      measure: 'MEASURE', measureSwap: 'EXPORT.',
      marquee: ['CREATE', 'ASSIGN', 'NOTIFY', 'TRACK', 'EXTEND', 'REVIEW', 'MEASURE'],
      echo: { days: 'DAYS' },
      secondary: ['ACCEPT', 'PROGRESS', 'REMIND', 'EXTEND', 'RESULTS', 'DEADLINES'],
      product: ['HU', 'IT'],
      tagline: 'Faculty Work Management System',
      closing: 'No task left behind.',
      end: {
        kind: 'Bachelor’s graduation thesis',
        title: 'Building a work management application for the Faculty of Information Technology',
        titleLines: ['Building a work management application', 'for the Faculty of Information Technology'],
        studentLabel: 'Students', supervisorLabel: 'Supervisor',
        faculty: 'Faculty of Information Technology',
        demo: 'Real application UI · sample data, simulated interactions',
      },
    },
  };

  // ---- END CARD ---------------------------------------------------------------
  // Only verified facts are shown. University name is taken from the app itself
  // (login page / logo alt text). Personal fields stay EMPTY until you fill them in;
  // an empty field is simply not rendered (no placeholders in the film).
  const THESIS = {
    code: 'CNTT-KLCN018',
    // from the approved thesis outline (đề cương chi tiết CNTT-KLCN018). Empty a field to hide it.
    students: [['Huỳnh Tuấn Ngọc', '2001230565'], ['Phan Đoàn Bách Hợp', '2001230280'], ['Nguyễn Quang Ngọc', '2001230569']],
    supervisor: 'Lâm Thị Họa Mi',   // add the academic title (ThS./TS.) exactly as on the report cover
    university: { vi: 'Trường Đại học Công Thương Thành phố Hồ Chí Minh', en: 'Ho Chi Minh City University of Industry and Trade' },
    year: '2026',
  };

  // ---- PALETTE: black, off-white, + ONE accent (app primary --blue #2563eb) --
  const C = { black: '#0b0b0c', off: '#f1efea', accent: '#2563eb' };

  // ---- AUDIO CUES — [section, action frame, sfx, (span in action frames)] -------
  // Positions follow the time warp automatically. tools/compose_audio.py synthesises
  // the score + SFX on these; tools/mux.mjs can lay your own audio/<sfx>.wav instead.
  const CUES = [
    ['hook', 15, 'hit'], ...[0, 1, 2, 3, 4, 5, 6].map((k) => ['tension', k * 15 + 2, 'tick']), ['tension', 105, 'hit'],
    // TẠO VIỆC
    ['create', 0, 'type', 12], ['create', 22, 'whoosh'], ['create', 42, 'click'], ['create', 44, 'open'], ['create', 56, 'click'],
    ['create', 62, 'typing', 10], ['create', 66, 'tick'], ['create', 70, 'tick'], ['create', 74, 'tick'], ['create', 92, 'click'], ['create', 97, 'toast'], ['create', 109, 'whoosh'],
    // GIAO VIỆC
    ['assign', 18, 'whoosh'], ['assign', 40, 'click'], ['assign', 44, 'open'], ['assign', 67, 'click'], ['assign', 79, 'click'],
    ['assign', 87, 'click'], ['assign', 95, 'toast'], ['assign', 100, 'whoosh'],
    // THÔNG BÁO
    ['notify', 0, 'whoosh'], ['notify', 22, 'whoosh'], ['notify', 44, 'click'], ['notify', 45, 'chime'], ['notify', 57, 'whoosh'],
    ['notify', 62, 'alert'], ['notify', 96, 'click'], ['notify', 100, 'whoosh'],
    // THEO DÕI
    ['track', 0, 'whoosh'], ['track', 17, 'whoosh'], ['track', 30, 'whoosh'], ['track', 41, 'click'], ['track', 44, 'toast'],
    ['track', 54, 'click'], ['track', 56, 'open'], ['track', 65, 'click'], ['track', 65, 'detents', 9], ['track', 76, 'click'],
    ['track', 77, 'typing', 10], ['track', 88, 'click'], ['track', 91, 'whoosh'], ['track', 96, 'move', 11], ['track', 109, 'whoosh'],
    // GIA HẠN
    ['extend', 0, 'stretch'], ['extend', 24, 'whoosh'], ['extend', 40, 'click'], ['extend', 41, 'open'], ['extend', 62, 'click'],
    ['extend', 80, 'click'], ['extend', 88, 'toast'], ['extend', 96, 'chime'], ['extend', 111, 'whoosh'],
    // DUYỆT
    ['review', 0, 'hit'], ['review', 15, 'whoosh'], ['review', 38, 'click'], ['review', 39, 'open'], ['review', 51, 'click'], ['review', 57, 'click'],
    ['review', 57, 'typing', 10], ['review', 68, 'click'], ['review', 75, 'toast'], ['review', 96, 'whoosh'],
    // THỐNG KÊ
    ['measure', 0, 'tick'], ['measure', 24, 'whoosh'], ['measure', 46, 'chime'], ['measure', 103, 'click'], ['measure', 105, 'hit'],
    // collage → identity
    ['build', 0, 'riser', 75], ['build', 75, 'whoosh'], ['lockup', 0, 'hit'],
  ];
  const AUDIO = CUES.filter(([sec]) => S[sec]).map(([sec, f, sfx, span]) => ({ beat: at(sec, f), sfx, ...(span ? { span: at(sec, f + span) - at(sec, f) } : {}), note: `${sec}@${f}` }));

  return { CUT, FPS, BPM, BEAT, b, S, TOTAL_BEATS, TOTAL_FRAMES: b(TOTAL_BEATS), COPY, THESIS, C, AUDIO, WARP, CAPTIONS, toAction, toSection, at, WARPED, SLOW };
})();
