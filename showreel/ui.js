// HUIT showreel — product UI rebuilt as live HTML (Apple-style product shots).
// The screens are not screenshots: they re-create the app's real dialogs and views
// (same labels, same demo data as the app's mock API) in vector type, so they stay
// crisp at any zoom and can animate their own interactions frame by frame.
// Palette is the film's: ink / off-white / one accent (the app's --blue #2563eb).
window.UIKIT = (() => {
  const INK = '#0b0b0c', ACC = '#2563eb';
  const MUT = 'rgba(11,11,12,.54)', LINE = 'rgba(11,11,12,.09)', FILL = 'rgba(11,11,12,.055)', TINT = 'rgba(37,99,235,.09)';
  const F = "font-family:'Inter UI',sans-serif;";
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const clamp = (v, a = 0, z = 1) => Math.min(z, Math.max(a, v));
  const lerp = (a, z, t) => a + (z - a) * t;
  const abs = (x, y, w, h, st = '', inner = '') => `<div style="position:absolute;left:${x}px;top:${y}px;${w != null ? `width:${w}px;` : ''}${h != null ? `height:${h}px;` : ''}${st}">${inner}</div>`;
  const t = (x, y, s, size, wt = 500, color = INK, extra = '') =>
    abs(x, y, null, null, `${F}font-size:${size}px;font-weight:${wt};color:${color};white-space:nowrap;line-height:1.25;letter-spacing:-0.01em;${extra}`, esc(s));
  const card = (w, h, inner, extra = '') =>
    `<div style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#fff;border-radius:22px;box-shadow:0 0 0 1px ${LINE},0 40px 90px rgba(0,0,0,.45);overflow:hidden;${extra}">${inner}</div>`;
  const avatar = (x, y, ini, on) =>
    abs(x, y, 40, 40, `border-radius:50%;background:${on ? ACC : INK};display:grid;place-items:center;${F}font-size:14px;font-weight:700;color:#fff`, ini);
  // touch indicator (Apple-style tap): {x, y, a (0..1 opacity), p (0..1 press)}
  const touch = (o) => (!o || o.a <= 0 ? '' :
    abs(o.x - 23, o.y - 23, 46, 46, `border-radius:50%;background:rgba(11,11,12,.16);box-shadow:inset 0 0 0 2px rgba(11,11,12,.38);opacity:${o.a};transform:scale(${1 - 0.18 * (o.p || 0)})`));
  // segmented control. segs: [label, width]; sel: {from, to, e} slides the pill; style 'light' (white pill) or 'accent'
  function seg(x, y, segs, sel, accentAmt = 0) {
    const h = 40; let ox = 4; const xs = segs.map(([, w]) => { const v = ox; ox += w; return v; });
    const total = ox + 4;
    const px = lerp(xs[sel.from], xs[sel.to], sel.e), pw = lerp(segs[sel.from][1], segs[sel.to][1], sel.e);
    const cur = sel.e < 0.5 ? sel.from : sel.to;
    let inner = abs(px, 4, pw, h - 8, `border-radius:9px;background:${accentAmt > 0 ? `color-mix(in srgb, ${ACC} ${accentAmt * 100}%, #fff)` : '#fff'};box-shadow:0 1px 3px rgba(0,0,0,.12)`);
    segs.forEach(([l, w], i) => {
      const on = i === cur;
      const col = on ? (accentAmt > 0.5 ? '#fff' : ACC) : INK;
      inner += abs(xs[i], 0, w, h, `display:grid;place-items:center;${F}font-size:15px;font-weight:${on ? 600 : 500};color:${col}`, esc(l));
    });
    return abs(x, y, total, h, `border-radius:12px;background:${FILL}`, inner);
  }

  // ---------------------------------------------------------------- Giao việc
  // st: { check (0..1 checkbox on row 1), touch }
  const ASSIGN_W = 600, ASSIGN_H = 560;
  const PEOPLE = [
    ['HV', 'Nguyễn Hồng Vũ', 'Khoa Công nghệ Thông tin', 0],
    ['TB', 'Phạm Thái Bảo', 'Bộ môn Khoa học dữ liệu', 0],
    ['DH', 'Ngô Dương Hà', 'Bộ môn Khoa học dữ liệu', 2],
    ['TM', 'Lê Thị Mai', 'Bộ môn Hệ thống thông tin', 1],
  ];
  function assignDialog(st = {}) {
    let h = '';
    h += t(32, 28, 'Giao việc', 26, 700);
    h += t(32, 64, 'Tư vấn tuyển sinh thạc sĩ đợt 2 · hạn chung 20/10/2026', 15, 500, MUT);
    h += t(32, 104, 'Giao cho', 14, 600);
    h += seg(32, 128, [['Cá nhân', 120], ['Cả đơn vị', 120]], { from: 0, to: 0, e: 0 });
    h += t(32, 190, 'Người nhận *', 14, 600);
    let rows = '';
    PEOPLE.forEach(([ini, name, unit, open], i) => {
      const y = i * 66;
      const chk = i === 1 ? (st.check || 0) : 0;
      if (chk > 0) rows += abs(0, y, 536, 66, `background:${TINT};opacity:${clamp(chk * 1.5)}`);
      if (i) rows += abs(16, y, 504, 1, `background:${LINE}`);
      // checkbox
      rows += abs(18, y + 22, 22, 22, `border-radius:7px;box-shadow:inset 0 0 0 1.5px rgba(11,11,12,.3);background:#fff`);
      if (chk > 0) {
        const s = 0.6 + 0.4 * chk;
        rows += abs(18, y + 22, 22, 22, `border-radius:7px;background:${ACC};transform:scale(${s});opacity:${clamp(chk * 2)}`,
          `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M6 11.5l3.4 3.4L16 8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="16" stroke-dashoffset="${16 * (1 - clamp(chk * 1.3 - 0.2))}"/></svg>`);
      }
      rows += avatar(56, y + 13, ini, i === 1 && chk > 0.5);
      rows += t(110, y + 11, name, 16, 600);
      rows += abs(110, y + 35, null, null, `${F}font-size:14px;font-weight:500;color:${MUT};white-space:nowrap`,
        `${esc(unit)} · <b style="font-weight:600;color:${open ? INK : ACC}">${open} việc đang mở</b>`);
    });
    h += abs(32, 214, 536, 264, `border-radius:14px;box-shadow:inset 0 0 0 1px ${LINE};overflow:hidden`, rows);
    h += t(32, 494, 'Vai trò', 14, 600);
    h += t(330, 494, 'Hạn riêng', 14, 600);
    h += t(330, 514, '20/10/2026', 15, 500, MUT, `padding:9px 12px;border-radius:10px;background:${FILL};width:214px`);
    let html = card(ASSIGN_W, ASSIGN_H, h + seg(32, 514, [['Không ghi', 96], ['Chủ trì', 84], ['Phối hợp', 92]], { from: 1, to: 1, e: 0 }));
    html += touch(st.touch);
    return html;
  }
  // anchor points (design px) used by the camera / touch
  const ASSIGN_PTS = { list: [300, 340], check1: [32 + 29, 214 + 66 + 33], center: [ASSIGN_W / 2, ASSIGN_H / 2] };

  // ---------------------------------------------------------------- Danh sách công việc
  const TASKS = [
    ['Xây dựng đề cương học phần Học máy', 'Đào tạo · Bộ môn Khoa học dữ liệu', 'Đang thực hiện', 57, '30/10', ''],
    ['Tư vấn tuyển sinh thạc sĩ đợt 2', 'Tuyển sinh · Khoa Công nghệ Thông tin', 'Đang thực hiện', 20, '20/10', 'trễ 5 ngày'],
    ['Cập nhật chương trình đào tạo CNTT 2026', 'Đào tạo · Khoa Công nghệ Thông tin', 'Chưa bắt đầu', 0, '26/10', 'còn 2 ngày'],
    ['Tổ chức hội thảo Khoa học dữ liệu 2026', 'Nghiên cứu khoa học · Bộ môn Khoa học dữ liệu', 'Chờ duyệt', 99, '03/11', ''],
    ['Báo cáo tổng kết học kỳ', 'Đào tạo · Bộ môn Khoa học dữ liệu', 'Hoàn thành', 100, '24/09', ''],
  ];
  const LIST_W = 920, ROW = 70, LIST_H = 56 + ROW * 5 + 12;
  const COL = { title: 28, status: 430, prog: 590, due: 800 };
  const BAR = 150;
  // st: { appear:[0..1]x5, fill:[0..1]x5, v0 (override value row 0), knob (0..1), touch }
  function taskList(st = {}) {
    let h = '';
    h += abs(0, 0, LIST_W, 56, `background:#fafaf8;box-shadow:inset 0 -1px 0 ${LINE}`);
    [['Công việc', COL.title], ['Trạng thái', COL.status], ['Tiến độ', COL.prog], ['Hạn', COL.due]].forEach(([l, x]) => { h += t(x, 19, l, 13, 600, MUT); });
    TASKS.forEach(([title, meta, status, val, due, note], i) => {
      const a = st.appear ? st.appear[i] : 1;
      if (a <= 0) return;
      const y = 56 + i * ROW;
      let r = '';
      if (i) r += abs(20, 0, LIST_W - 40, 1, `background:${LINE}`);
      r += t(COL.title, 14, title, 16, 600);
      r += t(COL.title, 39, meta, 13, 500, MUT);
      const done = status === 'Hoàn thành';
      r += abs(COL.status, 22, null, null, `${F}font-size:13px;font-weight:600;padding:5px 11px 5px 22px;border-radius:999px;white-space:nowrap;background:${done ? TINT : FILL};color:${done ? ACC : INK}`,
        `<i style="position:absolute;left:10px;top:11px;width:6px;height:6px;border-radius:50%;background:${done || status === 'Đang thực hiện' ? ACC : 'rgba(11,11,12,.35)'}"></i>${esc(status)}`);
      const v = i === 0 && st.v0 != null ? st.v0 : val * (st.fill ? st.fill[i] : 1);
      r += abs(COL.prog, 32, BAR, 6, `border-radius:3px;background:${FILL}`, abs(0, 0, (BAR * v) / 100, 6, `border-radius:3px;background:${ACC}`));
      if (i === 0 && st.knob > 0) r += abs(COL.prog + (BAR * v) / 100 - 11, 24, 22, 22, `border-radius:50%;background:#fff;box-shadow:0 0 0 1px ${LINE},0 2px 6px rgba(0,0,0,.25);transform:scale(${st.knob})`);
      r += t(COL.prog + BAR + 14, 25, `${Math.round(v)}%`, 14, 600, INK, 'font-variant-numeric:tabular-nums');
      r += t(COL.due, 14, due, 15, 600);
      if (note) r += t(COL.due, 38, note, 13, 600, note.startsWith('trễ') ? INK : MUT);
      h += abs(0, y + (1 - a) * 18, LIST_W, ROW, `opacity:${a}`, r);
    });
    return card(LIST_W, LIST_H, h, 'border-radius:18px') + touch(st.touch);
  }
  const LIST_PTS = { knob: (v) => [COL.prog + (BAR * v) / 100, 56 + 35], prog0: [COL.prog + 90, 56 + 35] };

  // ---------------------------------------------------------------- Đánh giá kết quả
  const REVIEW_W = 520, REVIEW_H = 470;
  // st: { pick (0..1 accent fill on "Đạt"), touch, rise (0..1) }
  function reviewDialog(st = {}) {
    let h = '';
    const p = st.pick || 0;
    h += t(32, 28, 'Đánh giá kết quả', 24, 700);
    h += t(32, 62, 'Ngô Dương Hà · lần nộp 1 · 23/10/2026', 15, 500, MUT);
    h += t(32, 100, 'Đã gửi kế hoạch hội thảo', 15, 500, INK, `padding:12px 16px;border-radius:12px;background:${FILL};width:424px`);
    h += t(32, 168, 'Quyết định *', 14, 600);
    h += seg(32, 192, [['Đạt', 72], ['Cần bổ sung', 124], ['Không đạt', 104]], { from: 0, to: 0, e: 0 }, p);
    h += t(32, 252, 'Nhận xét', 14, 600);
    h += abs(32, 276, 456, 84, `border-radius:12px;box-shadow:inset 0 0 0 1.5px ${LINE}`, t(14, 12, 'Bắt buộc khi chọn Cần bổ sung hoặc Không đạt', 14, 500, 'rgba(11,11,12,.36)'));
    h += abs(32, 384, 456, 1, `background:${LINE}`);
    h += abs(300, 404, 64, 42, `border-radius:12px;box-shadow:inset 0 0 0 1.5px ${LINE};display:grid;place-items:center;${F}font-size:15px;font-weight:600`, 'Hủy');
    h += abs(374, 404, 114, 42, `border-radius:12px;background:${ACC};opacity:${0.45 + 0.55 * p};display:grid;place-items:center;${F}font-size:15px;font-weight:600;color:#fff`, 'Lưu đánh giá');
    return card(REVIEW_W, REVIEW_H, h) + touch(st.touch);
  }
  const REVIEW_PTS = { pass: [32 + 4 + 36, 192 + 20] };

  // ---------------------------------------------------------------- Thống kê đơn vị
  const STATUS = [['Hoàn thành', 1, ACC], ['Đang thực hiện', 2, 'rgba(37,99,235,.45)'], ['Chờ duyệt', 1, 'rgba(11,11,12,.62)'], ['Chưa bắt đầu', 1, 'rgba(11,11,12,.22)'], ['Tạm dừng', 0, 'rgba(11,11,12,.08)']];
  const MONTHS = [['T2', 0, 2], ['T3', 3, 1], ['T4', 1, 0], ['T5', 4, 2], ['T6', 2, 1], ['T7', 0, 0]]; // [month, tạo mới, hoàn thành]
  const CA_W = 420, CB_W = 560, ST_H = 330, GAP = 20;
  function donutCard(sweep) {
    let h = t(28, 24, 'Theo trạng thái', 17, 700) + t(28, 50, '5 công việc trong kỳ', 13, 500, MUT);
    // conic ring drawn up to `sweep`
    let acc = 0; const stops = [];
    STATUS.forEach(([, n, c]) => { const a0 = acc, a1 = acc + n / 5; acc = a1; if (n) stops.push(`${c} ${Math.min(a0, sweep) * 360}deg ${Math.min(a1, sweep) * 360}deg`); });
    stops.push(`${FILL} ${sweep * 360}deg 360deg`);
    h += abs(28, 100, 168, 168, `border-radius:50%;background:conic-gradient(${stops.join(',')});-webkit-mask:radial-gradient(circle, transparent 57px, #000 58px);mask:radial-gradient(circle, transparent 57px, #000 58px)`);
    h += abs(28, 156, 168, null, `${F}text-align:center;font-size:30px;font-weight:700;color:${INK};letter-spacing:-0.02em`, `${Math.round(20 * Math.min(1, sweep * 5))}%`);
    h += abs(28, 194, 168, null, `${F}text-align:center;font-size:12px;font-weight:500;color:${MUT}`, 'hoàn thành');
    STATUS.forEach(([l, n, c], i) => {
      const y = 104 + i * 32;
      h += abs(224, y + 5, 10, 10, `border-radius:3px;background:${c}`);
      h += t(242, y, l, 14, 500);
      h += t(352, y, String(n), 14, 700);
      h += t(372, y, `${n * 20}%`, 13, 500, MUT);
    });
    return h;
  }
  const BAR_MAX = 4, BAR_H = 170, BASE = 290;
  function barsCard(grow, focus) {
    let h = t(28, 24, 'Tạo và hoàn thành theo tháng', 17, 700);
    h += abs(28, 56, 10, 10, `border-radius:3px;background:rgba(37,99,235,.22)`) + t(44, 51, 'Tạo mới', 13, 500, MUT);
    h += abs(118, 56, 10, 10, `border-radius:3px;background:${ACC}`) + t(134, 51, 'Hoàn thành', 13, 500, MUT);
    h += abs(28, BASE, CB_W - 56, 1, `background:${LINE}`);
    MONTHS.forEach(([m, c, d], i) => {
      const g = grow ? grow[i] : 1;
      const dim = focus > 0 && m !== 'T5' ? 1 - 0.65 * focus : 1;
      const x = 52 + i * 82;
      const hc = Math.max(3, (c / BAR_MAX) * BAR_H * g), hd = Math.max(3, (d / BAR_MAX) * BAR_H * g);
      let col = abs(x, BASE - hc, 26, hc, `border-radius:6px 6px 2px 2px;background:rgba(37,99,235,.22)`);
      col += abs(x + 30, BASE - hd, 26, hd, `border-radius:6px 6px 2px 2px;background:${ACC}`);
      col += t(x - 4, BASE - hc - 22, String(c), 13, 600, MUT, `width:34px;text-align:center;opacity:${clamp(g * 2 - 1)}`);
      col += t(x + 26, BASE - hd - 22, String(d), 13, 600, INK, `width:34px;text-align:center;opacity:${clamp(g * 2 - 1)}`);
      col += t(x + 14, BASE + 10, m, 13, 600, MUT);
      h += abs(0, 0, CB_W, ST_H, `opacity:${dim}`, col);
    });
    if (focus > 0) { // tooltip on T5
      const x = 52 + 3 * 82 + 28;
      h += abs(x, 66, null, 36, `padding:0 14px;border-radius:10px;background:${INK};opacity:${focus};transform:translate(-50%, ${(1 - focus) * 8}px);display:grid;place-items:center;${F}font-size:13px;font-weight:600;color:#fff;white-space:nowrap`,
        'T5 · 4 tạo mới · 2 hoàn thành');
    }
    return h;
  }
  // st: { sweep 0..1, grow [6], focus 0..1 }, layout 'row' (980 wide) or 'stack' (560 wide)
  function stats(st = {}, layout = 'row') {
    const a = `<div style="position:absolute;left:0;top:0;width:${CA_W}px;height:${ST_H}px;background:#fff;border-radius:20px;box-shadow:0 0 0 1px ${LINE},0 40px 90px rgba(0,0,0,.45);overflow:hidden">${donutCard(st.sweep ?? 1)}</div>`;
    const bx = layout === 'row' ? CA_W + GAP : 0, by = layout === 'row' ? 0 : ST_H + GAP;
    const bcard = `<div style="position:absolute;left:${bx}px;top:${by}px;width:${CB_W}px;height:${ST_H}px;background:#fff;border-radius:20px;box-shadow:0 0 0 1px ${LINE},0 40px 90px rgba(0,0,0,.45);overflow:hidden">${barsCard(st.grow, st.focus || 0)}</div>`;
    return a + bcard;
  }
  const STATS = {
    size: (layout) => (layout === 'row' ? [CA_W + GAP + CB_W, ST_H] : [CB_W, ST_H * 2 + GAP]),
    t5: (layout) => (layout === 'row' ? [CA_W + GAP + 52 + 3 * 82 + 28, 165] : [52 + 3 * 82 + 28, ST_H + GAP + 165]),
  };

  return {
    assignDialog, ASSIGN_W, ASSIGN_H, ASSIGN_PTS,
    taskList, LIST_W, LIST_H, LIST_PTS,
    reviewDialog, REVIEW_W, REVIEW_H, REVIEW_PTS,
    stats, STATS,
  };
})();
