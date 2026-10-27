// HUIT showreel — deterministic frame renderer.
// renderFrame(f) is a pure function of the frame index: the same frame always
// produces the same picture, so tools/render.mjs can capture frames in any order.
(() => {
  const R = window.REEL;
  const q = new URLSearchParams(location.search);
  const W = +q.get('w') || 1920, H = +q.get('h') || 1080;
  const LANG = q.get('lang') || 'vi';
  const T = R.COPY[LANG], C = R.C, b = R.b;
  const PORTRAIT = H > W;
  const M = Math.round((PORTRAIT ? 0.067 : 0.05) * W);   // outer margin (96 px @1920, 72 px @1080 wide)
  const LS = -0.03;                                       // tracking for display type
  const stage = document.getElementById('stage');
  stage.style.width = W + 'px'; stage.style.height = H + 'px';

  // ---- easing ---------------------------------------------------------------
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-6 || !d) break; t -= e / d; }
      return sy(Math.min(1, Math.max(0, t)));
    };
  }
  const OUT = bezier(0.16, 1, 0.3, 1);          // house entrance curve
  const SNAP = bezier(0.05, 0.9, 0.1, 1);       // sharper, for slams
  const IN = (x) => x * x * x;                  // collapse
  const IO = bezier(0.65, 0, 0.35, 1);          // camera / cursor: controlled accel + decel
  const clamp = (v, a = 0, z = 1) => Math.min(z, Math.max(a, v));
  const lerp = (a, z, t) => a + (z - a) * t;
  const P = (lf, start, dur) => clamp((lf - start) / dur);

  // ---- font metrics & measuring --------------------------------------------
  let MET = null;
  function metrics() {
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = '900 100px "Be Vietnam Pro"';
    const m = cv.measureText('H');
    MET = { asc: m.fontBoundingBoxAscent / 100, desc: m.fontBoundingBoxDescent / 100, cap: m.actualBoundingBoxAscent / 100 };
    // baseline offset inside a line-height:1 box
    MET.base = (1 - (MET.asc + MET.desc)) / 2 + MET.asc;
  }
  const meas = document.createElement('span');
  meas.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:pre;line-height:1;font-family:"Be Vietnam Pro"';
  document.body.appendChild(meas);
  const mcache = new Map();
  function width(str, size, weight = 900, ls = LS) {
    const k = str + '|' + weight + '|' + ls;
    if (!mcache.has(k)) {
      meas.style.fontWeight = weight; meas.style.fontSize = '100px'; meas.style.letterSpacing = ls + 'em';
      meas.textContent = str;
      mcache.set(k, meas.getBoundingClientRect().width / 100 + ls * -1); // drop trailing tracking
    }
    return mcache.get(k) * size;
  }
  const fit = (str, maxW, maxH, weight = 900) => Math.min(maxW / width(str, 1, weight), maxH);
  // tight leading for plain caps; open it up when Vietnamese marks would collide between lines
  const LEAD = (lines) => (lines.some((l) => /[^\x00-\x7F→·]/.test(l)) ? 1.22 : 0.92);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // text block positioned by caps: x (by align) and capMid = vertical centre of the capitals
  function txt(str, o) {
    const size = o.size, wt = o.weight || 900, ls = o.ls ?? LS;
    const w = width(str, size, wt, ls);
    const left = o.align === 'center' ? o.x - w / 2 : o.align === 'right' ? o.x - w : o.x;
    const baseline = o.baseline ?? (o.capMid + (MET.cap * size) / 2);
    const top = baseline - MET.base * size;
    const tf = o.transform ? `transform:${o.transform};transform-origin:${o.origin || 'center'};` : '';
    const html = o.html || esc(str);
    return {
      w, left, top, baseline, capTop: baseline - MET.cap * size, size,
      html: `<div class="t" style="left:${left}px;top:${top}px;font-size:${size}px;font-weight:${wt};letter-spacing:${ls}em;color:${o.color || C.off};${tf}${o.style || ''}">${html}</div>`,
    };
  }
  const box = (x, y, w, h, style) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${style}"></div>`;

  // ======================= LAYERS ===========================================
  // #under  type that sits behind the product UI
  // #ui     live product UI: real React DOM states (app/states/*.html) in iframes
  // #over   type, masks, highlight rings that sit on top of the UI
  // #cursor pointer
  stage.innerHTML = '<div id="under" style="position:absolute;inset:0;z-index:0"></div><div id="ui" style="position:absolute;inset:0;overflow:hidden;z-index:1"></div>' +
    '<div id="over" style="position:absolute;inset:0;z-index:2"></div><div id="cursor" style="position:absolute;left:0;top:0;width:0;height:0;z-index:10"></div>';
  const L = { under: stage.querySelector('#under'), ui: stage.querySelector('#ui'), over: stage.querySelector('#over'), cursor: stage.querySelector('#cursor') };
  const U = Math.min(W, H) / 1080;                                         // screen unit

  // ======================= LIVE UI (real app DOM) ============================
  const PAGE = { w: 1600, h: 900 };
  const STATES = ['C0_create', 'C1_tpl', 'C2_filled', 'C3_created', 'A0_detail', 'A1_dialog', 'A3_done', 'B0_home', 'B1_bell', 'N0_alert',
    'T0_board', 'T1_mine', 'T2_accepted', 'T3_progress', 'T5_board', 'X0_ext', 'X1_dialog', 'X2_done',
    'R0_result', 'R1_dialog', 'R2_done', 'S_before', 'S1_stats'];
  const UIX = (() => {
    const F = {};
    let mods = [];
    async function load() {
      await Promise.all(STATES.map((id) => new Promise((res) => {
        const fr = document.createElement('iframe');
        fr.src = `app/states/${id}.html`;
        fr.setAttribute('scrolling', 'no');
        fr.style.cssText = `position:absolute;left:0;top:0;width:${PAGE.w}px;height:${PAGE.h}px;border:0;transform-origin:0 0;visibility:hidden;background:#fff`;
        fr.onload = async () => {
          const doc = fr.contentDocument;
          try { await doc.fonts.ready; await Promise.all([400, 500, 600, 700].map((w) => doc.fonts.load(`${w} 16px Inter`, 'Giao việc ƯƠỆỮẶ'))); } catch (e) { /* ignore */ }
          const rects = {};
          doc.querySelectorAll('[data-sr]').forEach((e) => { const r = e.getBoundingClientRect(); rects[e.getAttribute('data-sr')] = { x: r.left, y: r.top, w: r.width, h: r.height }; });
          F[id] = { fr, doc, rects };
          res();
        };
        L.ui.appendChild(fr);
      })));
    }
    const LAST = {};
    function begin() {
      Object.keys(LAST).forEach((k) => delete LAST[k]);
      for (let i = mods.length - 1; i >= 0; i--) mods[i]();
      mods = [];
      Object.values(F).forEach((f) => { f.fr.style.visibility = 'hidden'; f.fr.style.opacity = '1'; f.fr.style.zIndex = '0'; f.fr.style.clipPath = 'none'; f.fr.style.filter = 'none'; });
    }
    function set(el, kind, name, val) {
      if (!el) return;
      if (kind === 'text' && val === undefined) val = name;          // set(el, 'text', value)
      let undo;
      if (kind === 'style') { const old = el.style.getPropertyValue(name); el.style.setProperty(name, val); undo = () => el.style.setProperty(name, old); }
      else if (kind === 'prop') { const old = el[name]; el[name] = val; undo = () => { el[name] = old; }; }
      else if (kind === 'class') { const had = el.classList.contains(name); el.classList.toggle(name, !!val); undo = () => el.classList.toggle(name, had); }
      else if (kind === 'text') { const old = el.textContent; el.textContent = val; undo = () => { el.textContent = old; }; }
      else if (kind === 'attr') { const old = el.getAttribute(name); el.setAttribute(name, val); undo = () => (old == null ? el.removeAttribute(name) : el.setAttribute(name, old)); }
      mods.push(undo);
    }
    const css = (el, props) => Object.entries(props).forEach(([k, v]) => set(el, 'style', k, v));
    function show(id, c, o = {}) {
      const f = F[id]; if (!f) return;
      const tx = c.cx - c.fx * c.s + (o.dx || 0), ty = c.cy - c.fy * c.s + (o.dy || 0);
      f.fr.style.visibility = 'visible';
      LAST[id] = { c, dx: o.dx || 0, dy: o.dy || 0 };
      f.fr.style.transform = `translate(${tx}px,${ty}px) scale(${c.s})`;
      f.fr.style.opacity = String(o.opacity ?? 1);
      f.fr.style.zIndex = String(o.z || 1);
      if (o.clip) f.fr.style.clipPath = o.clip;
      if (o.filter) f.fr.style.filter = o.filter;
    }
    const doc = (id) => F[id].doc;
    const q = (id, sel) => F[id].doc.querySelector(sel);
    const qa = (id, sel) => [...F[id].doc.querySelectorAll(sel)];
    const el = (id, key) => q(id, `[data-sr="${key}"]`);
    // element rect (page px) — measured once on load, before any animation touched it
    const rect = (id, key) => F[id].rects[key];
    const rectOf = (id, e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const camOf = (id) => LAST[id];
    return { load, begin, set, css, show, doc, q, qa, el, rect, rectOf, camOf };
  })();

  // ---- camera: page point (fx, fy) lands on screen point (cx, cy) at scale s --
  const FILL = Math.max(W / PAGE.w, H / PAGE.h);
  const FULL = () => ({ s: FILL, fx: PAGE.w / 2, fy: PAGE.h / 2, cx: W / 2, cy: H / 2 });
  function clampCam(c) {
    const o = { ...c };
    const hw = W / 2 / o.s, hh = H / 2 / o.s;
    if (PAGE.w * o.s >= W) o.fx = clamp(o.fx, (o.cx) / o.s, PAGE.w - (W - o.cx) / o.s);
    if (PAGE.h * o.s >= H) o.fy = clamp(o.fy, (o.cy) / o.s, PAGE.h - (H - o.cy) / o.s);
    return o;
  }
  // camera framed on an element (page coords), optional offset in page px
  const on = (id, key, s, ox = 0, oy = 0) => { const r = UIX.rect(id, key); return clampCam({ s, fx: r.x + r.w / 2 + ox, fy: r.y + r.h / 2 + oy, cx: W / 2, cy: H / 2 }); };
  const at = (s, fx, fy) => clampCam({ s, fx, fy, cx: W / 2, cy: H / 2 });
  const camLerp = (a, z, e) => ({ s: lerp(a.s, z.s, e), fx: lerp(a.fx, z.fx, e), fy: lerp(a.fy, z.fy, e), cx: lerp(a.cx, z.cx, e), cy: lerp(a.cy, z.cy, e) });
  // keyframed camera (IO eased between keys) — keys: [[frame, cam], …]
  function camPath(lf, keys) {
    if (lf <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [f0, c0] = keys[i], [f1, c1] = keys[i + 1];
      if (lf < f1) return camLerp(c0, c1, IO(P(lf, f0, f1 - f0)));
    }
    return keys[keys.length - 1][1];
  }
  const toS = (c, x, y) => [c.cx + (x - c.fx) * c.s, c.cy + (y - c.fy) * c.s];
  const center = (id, key, ox = 0, oy = 0) => { const r = UIX.rect(id, key); return [r.x + r.w / 2 + ox, r.y + r.h / 2 + oy]; };

  // ---- cursor ---------------------------------------------------------------
  // keys: [[frame, target]] — target is {p:[x,y]} page px (follows the camera) or {s:[x,y]} screen px
  const CURSOR_SVG = (sz) => `<svg width="${sz}" height="${sz * 1.5}" viewBox="0 0 20 30" style="position:absolute;left:0;top:0;overflow:visible;filter:drop-shadow(0 ${2 * U}px ${4 * U}px rgba(0,0,0,.35))">` +
    '<path d="M1.5 1.5 L1.5 23.2 L6.8 18.3 L10.4 26.6 L14.1 25 L10.6 16.9 L17.6 16.9 Z" fill="#fff" stroke="#0b0b0c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function cursorPos(lf, keys, c) {
    const pt = (k) => (k.s ? k.s : toS(c, k.p[0], k.p[1]));
    if (lf <= keys[0][0]) return pt(keys[0][1]);
    for (let i = 0; i < keys.length - 1; i++) {
      const [f0, k0] = keys[i], [f1, k1] = keys[i + 1];
      if (lf < f1) {
        const e = IO(P(lf, f0, f1 - f0)); const a = pt(k0), z = pt(k1);
        const dx = z[0] - a[0], dy = z[1] - a[1], arc = Math.sin(Math.PI * e) * 0.07;  // gentle arc, never a straight robot line
        return [a[0] + dx * e - dy * arc, a[1] + dy * e + dx * arc];
      }
    }
    return pt(keys[keys.length - 1][1]);
  }
  // renders the pointer (+ click ring into #over). clicks: frames where the button goes down.
  function cursor(lf, keys, clicks, c) {
    const f0 = keys[0][0], f1 = keys[keys.length - 1][0] + 6;
    if (lf < f0 || lf > f1) { L.cursor.innerHTML = ''; return ''; }
    const [x, y] = cursorPos(lf, keys, c);
    const a = Math.min(P(lf, f0, 3), 1 - P(lf, f1 - 4, 4));
    let press = 0, ring = '';
    for (const cf of clicks) {
      if (lf >= cf && lf < cf + 4) press = 1 - Math.abs(lf - cf - 1.5) / 2.5;
      const t = lf - cf;
      if (t >= 0 && t < 10) {
        const r = lerp(8, 34, OUT(t / 10)) * U;
        ring += `<div style="position:absolute;left:${x - r}px;top:${y - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;box-shadow:inset 0 0 0 ${3 * U}px ${C.accent};opacity:${0.9 * (1 - t / 10)}"></div>`;
      }
    }
    const sz = 30 * U;
    L.cursor.innerHTML = `<div style="position:absolute;left:${x - 1.5 * sz / 20}px;top:${y - 1.5 * sz / 20}px;opacity:${a};transform:scale(${1 - 0.14 * clamp(press)});transform-origin:0 0">${CURSOR_SVG(sz)}</div>`;
    return ring;
  }
  // accent ring around a page element, mapped through the camera (restrained confirmation)
  function ringAround(id, key, c, e, pad = 8, el) {
    if (e <= 0) return '';
    const r = el ? UIX.rectOf(id, el) : UIX.rect(id, key);
    const [x0, y0] = toS(c, r.x - pad, r.y - pad), [x1, y1] = toS(c, r.x + r.w + pad, r.y + r.h + pad);
    return `<div style="position:absolute;left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;border-radius:${12 * c.s}px;box-shadow:0 0 0 ${3 * U}px ${C.accent};opacity:${clamp(e)};transform:scale(${lerp(1.06, 1, OUT(clamp(e)))})"></div>`;
  }
  // press feedback on a real button: brief scale-down after the click frame
  const pressEl = (el, lf, cf) => { if (lf >= cf && lf < cf + 5) UIX.css(el, { scale: String(1 - 0.04 * (1 - Math.abs(lf - cf - 2) / 3)) }); };
  // modal open/close on a real <dialog> state: e = 0 (closed) → 1 (open)
  function dialogAnim(id, e) {
    UIX.css(UIX.el(id, 'backdrop'), { opacity: String(clamp(e)) });
    UIX.css(UIX.el(id, 'dlg'), { opacity: String(clamp(e * 1.4)), scale: String(lerp(0.955, 1, e)), translate: `0 ${lerp(18, 0, e)}px` });
  }
  // the app's own toast (#toast): slides up into place
  function toastIn(id, e) { UIX.css(UIX.q(id, '#toast'), { opacity: String(clamp(e * 1.5)), translate: `0 ${lerp(24, 0, e)}px` }); }
  function typeInto(el, full, e) { UIX.set(el, 'prop', 'value', full.slice(0, Math.round(full.length * clamp(e)))); }
  // directional motion blur: a real 1-D gaussian along the direction of travel (SVG filter),
  // strength proportional to speed (px/frame) — subtle, only while the word is moving fast
  let mbN = 0;
  function moving(make, vx, vy) {
    const sx = Math.min(36, Math.abs(vx) * 0.16), sy = Math.min(36, Math.abs(vy) * 0.16);
    if (sx < 1.5 && sy < 1.5) return make(0, 0, 1);
    const id = 'mb' + (mbN++);
    return `<svg width="0" height="0" style="position:absolute"><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sx.toFixed(1)} ${sy.toFixed(1)}"/></filter></svg>` +
      `<div style="position:absolute;inset:0;filter:url(#${id})">${make(0, 0, 1)}</div>`;
  }
  // SVG overlay: frame-black everywhere except through the letterforms and an optional rect
  function windowMask(t, size, word, hole) {
    const id = 'wm' + Math.round(size);
    const r = hole ? `<rect x="${hole.l}" y="${hole.t}" width="${Math.max(0, hole.r - hole.l)}" height="${Math.max(0, hole.b - hole.t)}" fill="black"/>` : '';
    return `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0"><defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">` +
      `<rect width="${W}" height="${H}" fill="white"/>` +
      `<text x="${t.left}" y="${t.baseline}" style="font-family:'Be Vietnam Pro';font-weight:900;font-size:${size}px;letter-spacing:${LS}em;white-space:pre" fill="black">${esc(word)}</text>${r}` +
      `</mask></defs><rect width="${W}" height="${H}" fill="${C.black}" mask="url(#${id})"/></svg>`;
  }
  const wordLines = (lines, size, colorFn) => lines.map((w, i) => txt(w, { x: W / 2, capMid: H / 2 + (i - (lines.length - 1) / 2) * size * LEAD(lines), size, align: 'center', color: colorFn(i) }).html).join('');

  // ======================= SCENES ===========================================
  // each returns { bg, under, over } (html strings); UI is driven through UIX.

  function hook(lf) {
    if (lf < b(1)) return { bg: C.black };                                    // count-in: black
    const t = lf - b(1);
    const word = T.hook;
    const size = fit(word + '.', W * 0.8, H * 0.4);
    const s = lerp(1.4, 1, SNAP(P(t, 0, 7))) * lerp(1, 0.985, P(t, 8, 37));  // slam, then a slow held settle
    const html = `${esc(word)}<span style="color:${C.accent}">.</span>`;
    let out = '';
    if (t < 2) [[1.10, 0.18], [1.05, 0.30]].forEach(([g, a]) => {           // 2-frame zoom blur
      out += txt(word + '.', { x: W / 2, capMid: H / 2, size, align: 'center', html, transform: `scale(${s * g})`, style: `opacity:${a}` }).html;
    });
    out += txt(word + '.', { x: W / 2, capMid: H / 2, size, align: 'center', html, transform: `scale(${s})` }).html;
    return { bg: C.black, over: out };
  }

  // Tension: one dominant word per beat; each replaced word flies up into a quiet
  // running ledger along the top — readable hierarchy instead of a pile of overlaps.
  function tension(lf) {
    const k = Math.floor(lf / b(1));
    const words = T.tension;
    if (k >= 7) {                                                           // GRID SNAP + colour invert #1
      let out = '';
      const rows = words.length, colW = W - 2 * M;
      const longest = words.reduce((a, w) => (width(w, 1) > width(a, 1) ? w : a));
      const rowH = (H - 2 * M) / rows;
      const size = Math.min(fit(longest, colW * 0.62, Infinity), ((rowH * 0.7) / MET.cap) * (0.92 / LEAD(words)));
      words.forEach((w, i) => {
        const y = M + i * rowH;
        out += box(M, y, colW, 2, `background:${C.black}`);
        out += txt(String(i + 1).padStart(2, '0'), { x: M + colW, baseline: y + size * 0.36, size: Math.max(16, size * 0.16), weight: 500, ls: 0, align: 'right', color: C.black }).html;
        out += txt(w, { x: M, baseline: y + rowH * 0.5 + (MET.cap * size) / 2, size, color: C.black }).html;
      });
      return { bg: C.off, over: out };
    }
    // ledger geometry
    const ls = Math.round(H * 0.036), gap = ls * 0.9;
    const slots = []; let x = M;
    words.forEach((w) => { slots.push(x); x += width(w, ls) + gap; });
    const ledgerBase = M + MET.cap * ls;
    const domSize = (w) => Math.min(fit(w, W * 0.8, Infinity), H * 0.3);
    let out = '';
    for (let i = 0; i < k; i++) {                                           // words already in the ledger
      const w = words[i];
      const t2 = lf - b(i + 1);                                            // it left the centre on the next beat
      const e = i === k - 1 ? OUT(P(t2, 0, 8)) : 1;
      const ds = domSize(w), dw = width(w, ds);
      const size = lerp(ds, ls, e);
      const left = lerp(W / 2 - dw / 2, slots[i], e);
      const base = lerp(H * 0.55 + (MET.cap * ds) / 2, ledgerBase, e);
      out += txt(w, { x: left, baseline: base, size, style: `opacity:${lerp(1, 0.4, e)}` }).html;
      out += txt(String(i + 1).padStart(2, '0'), { x: slots[i], baseline: ledgerBase + ls * 0.75, size: Math.round(ls * 0.42), weight: 500, ls: 0.04, style: `opacity:${0.35 * e}` }).html;
    }
    const w = words[k], t = lf - b(k);
    const ds = domSize(w);
    const dir = k % 2 ? -1 : 1;                                            // alternate directions
    const e = OUT(P(t, 2, 7));                                             // arrives after the old word has left
    const dx = dir * W * 0.12 * (1 - e);
    const vx = dx - dir * W * 0.12 * (1 - OUT(P(t - 1, 2, 7)));         // px/frame, for the blur trail
    const make = (ox, oy, a) => txt(w, { x: W / 2 + dx + ox, capMid: H * 0.55, size: ds, align: 'center', style: `opacity:${a}` }).html;
    if (t >= 2) out += moving(make, vx, 0);
    return { bg: C.black, over: out };
  }

  // ---------------------------------------------------------------- GIAO VIỆC
  function assign(lf) {
    const word = T.assign;
    const size = fit(word, W * 0.86, H * 0.36);
    const t = txt(word, { x: W / 2, capMid: H / 2, size, align: 'center' });
    if (lf < b(1)) {                                                        // beat 1: word rises through a line mask
      const e = OUT(P(lf, 0, 7));
      const top = t.capTop - size * 0.45, bot = t.baseline + size * 0.3;
      const inner = txt(word, { x: W / 2, capMid: H / 2 + (1 - e) * size * 1.7, size, align: 'center' }).html;
      return { bg: C.black, over: `<div style="position:absolute;left:0;top:${top}px;width:${W}px;height:${bot - top}px;overflow:hidden"><div style="position:absolute;left:0;top:${-top}px;width:${W}px;height:${H}px">${inner}</div></div>` };
    }
    // ---- camera through the whole scene
    const camK = [
      [b(1), at(FILL * 1.75, 640, 170)],                                      // through the letters: title + status
      [b(2) - 1, at(FILL * 1.3, 1080, 260)],                                  // window open: the task page
      [b(3) - 3, on('A0_detail', 'btnAssign', FILL * 1.55, -260, 60)],        // toward “+ Giao việc”
      [b(3) + 8, FULL()],                                                      // the dialog opens — show all of it
      [b(4) + 6, on('A1_dialog', 'rowBao', FILL * 1.75, 120, 30)],            // push in on the recipients
      [b(5) + 4, on('A1_dialog', 'roleLead', FILL * 1.55, 220, 60)],          // role + submit
      [b(6) - 2, on('A1_dialog', 'roleLead', FILL * 1.55, 220, 60)],
      [b(6) + 8, FULL()],                                                      // dialog closes, pull back
      [b(7) - 2, on('A3_done', 'kvAssign', FILL * 1.5, 0, 140)],              // confirmation: count + toast
    ];
    const c = camPath(lf, camK);
    let over = '';
    // ---- which real state is on screen
    if (lf < b(3) - 1) {
      UIX.show('A0_detail', c);
      pressEl(UIX.el('A0_detail', 'btnAssign'), lf, b(3) - 5);
    } else if (lf < b(6) + 5) {
      UIX.show('A1_dialog', c);
      const open = OUT(P(lf, b(3) - 1, 9)), close = P(lf, b(6) - 2, 7);
      dialogAnim('A1_dialog', open * (1 - IN(close)));
      const row = UIX.el('A1_dialog', 'rowBao');
      if (lf >= b(4) + 7) UIX.set(row.querySelector('input'), 'prop', 'checked', true);           // tick Phạm Thái Bảo
      if (lf >= b(5) + 4) {                                                                          // role → Chủ trì
        const seg = UIX.el('A1_dialog', 'roleLead').parentElement;
        [...seg.querySelectorAll('label')].forEach((l) => { UIX.set(l, 'class', 'on', l === UIX.el('A1_dialog', 'roleLead')); UIX.set(l.querySelector('input'), 'prop', 'checked', l === UIX.el('A1_dialog', 'roleLead')); });
      }
      pressEl(UIX.el('A1_dialog', 'submit'), lf, b(6) - 3);
    } else {
      UIX.show('A3_done', c);
      toastIn('A3_done', OUT(P(lf, b(6) + 5, 8)));
      over += ringAround('A3_done', 'kvAssign', c, P(lf, b(6) + 10, 5), 6);
    }
    // ---- cursor: from the corner → + Giao việc → Phạm Thái Bảo → Chủ trì → Giao việc
    const bx = center('A0_detail', 'btnAssign'), chk = UIX.el('A1_dialog', 'rowBao').querySelector('input');
    const ck = UIX.rectOf('A1_dialog', chk);
    over += cursor(lf, [
      [b(2) - 2, { s: [W * 0.9, H * 1.05] }],
      [b(3) - 6, { p: bx }],
      [b(4) - 2, { p: bx }],
      [b(4) + 6, { p: [ck.x + ck.w / 2, ck.y + ck.h / 2] }],
      [b(5) - 2, { p: [ck.x + ck.w / 2, ck.y + ck.h / 2] }],
      [b(5) + 3, { p: center('A1_dialog', 'roleLead') }],
      [b(5) + 6, { p: center('A1_dialog', 'roleLead') }],
      [b(6) - 4, { p: center('A1_dialog', 'submit') }],
      [b(6) + 2, { p: center('A1_dialog', 'submit') }],
    ], [b(3) - 5, b(4) + 7, b(5) + 4, b(6) - 3], c);
    // ---- letters as a window onto the product, then the window opens
    if (lf < b(2)) {
      const e = IO(P(lf, b(1) + 3, 11));
      const pad = size * 0.06;
      const r0 = { l: t.left - pad, t: t.capTop - pad, r: t.left + t.w + pad, b: t.baseline + pad };
      const hole = lf >= b(1) + 3 ? { l: lerp(r0.l, -2, e), t: lerp(r0.t, -2, e), r: lerp(r0.r, W + 2, e), b: lerp(r0.b, H + 2, e) } : null;
      if (e < 1) over = windowMask(t, size, word, hole) + over;
    }
    // ---- beat 8: ĐÃ GIAO. rides in on a black curtain that wipes the interface away
    if (lf >= b(7) - 5) {
      const w2 = T.assignDone, s2 = fit(w2, W * 0.7, H * 0.3), ww = width(w2, s2);
      const e = OUT(P(lf, b(7) - 5, 9)), ePrev = OUT(P(lf - 1, b(7) - 5, 9));
      const edge = lerp(W, 0, e), vx = (lerp(W, 0, e) - lerp(W, 0, ePrev));
      const make = (ox, oy, a) => txt(w2, { x: edge + (W - ww) / 2 + ox, capMid: H / 2, size: s2, style: `opacity:${a}` }).html;
      over += box(edge, 0, W - edge + 2, H, `background:${C.black}`) + moving(make, vx, 0);
    }
    return { bg: C.black, over };
  }

  // ---------------------------------------------------------------- THEO DÕI
  function track(lf) {
    const word = T.track;
    const barW = W * 0.16;
    const size = fit(word, W * 0.86, H * 0.36);
    if (lf < b(1) + 2) {                                                    // beat 1: accent-bar wipe reveal
      const x = lerp(-barW, W, OUT(P(lf, 0, 10)));
      const t = txt(word, { x: W / 2, capMid: H / 2, size, align: 'center' });
      const clipR = Math.max(0, (t.left + t.w) - x);
      const t2 = txt(word, { x: W / 2, capMid: H / 2, size, align: 'center', style: `clip-path:inset(-50% ${clipR + size * 0.1}px -50% -50%)` });
      return { bg: C.black, over: t2.html + box(x, 0, barW, H, `background:${C.accent}`) };
    }
    let over = '', under = '';
    // beat 2: word exits left, the board slides in from the right (parallax: word moves faster)
    const slideIn = IO(P(lf, b(1) + 2, 10));
    if (lf < b(1) + 12) {
      const e = slideIn, eP = IO(P(lf - 1, b(1) + 2, 10));
      const make = (ox, oy, a) => txt(word, { x: W / 2 - e * W * 1.1 + ox, capMid: H / 2, size, align: 'center', style: `opacity:${a}` }).html;
      over += moving(make, -(e - eP) * W * 1.1, 0);
    }
    const card2 = UIX.el('T0_board', 'card2');
    const boardCam = camPath(lf, [
      [b(1), FULL()], [b(1) + 6, FULL()],
      [b(2) - 1, on('T0_board', 'card2', FILL * 1.9, 60, 0)],                // focus the one task
      [b(6) + 2, on('T0_board', 'card2', FILL * 1.9, 60, 0)],
      [b(6) + 12, on('T0_board', 'card2', FILL * 1.45, 330, -40)],          // follow it across columns
      [b(7) + 2, FULL()],                                                     // pull back: the whole board
    ]);
    const mineCam = camPath(lf, [
      [b(2), on('T1_mine', 'rowMai', FILL * 1.6, 240, 40)],
      [b(3) + 8, on('T1_mine', 'rowMai', FILL * 1.6, 240, 40)],
      [b(4) - 2, FULL()],
      [b(4) + 5, on('T3_progress', 'range', FILL * 1.85, 40, 60)],
      [b(5) + 6, on('T3_progress', 'note', FILL * 1.75, 0, 70)],
      [b(6), on('T3_progress', 'submit', FILL * 1.5, -200, -120)],
    ]);
    // segment A (beats 2–3): manager's board, the task in focus
    // segment B (beats 3–6): the assignee accepts and reports progress in her own view
    // segment C (beats 7–8): back on the board — the card moves to its new column
    const swapB = IO(P(lf, b(2), 9));                                       // board → assignee (directional)
    const swapC = IO(P(lf, b(6) + 1, 9));                                   // assignee → board
    if (lf < b(2) + 9) {
      UIX.show('T0_board', boardCam, { dx: (1 - slideIn) * W - swapB * W * 0.35, opacity: 1 - swapB * 0.6 });
      if (lf >= b(1) + 8) {                                                 // spotlight: dim every other card
        const d = OUT(P(lf, b(1) + 8, 6));
        UIX.qa('T0_board', '.kanban-card').forEach((e) => { if (e !== card2) UIX.css(e, { opacity: String(1 - 0.7 * d) }); });
        UIX.qa('T0_board', '.kanban-col header').forEach((e, i) => { if (i !== 0) UIX.css(e, { opacity: String(1 - 0.6 * d) }); });
      }
      over += ringAround('T0_board', null, boardCam, P(lf, b(2) - 4, 4), 5, UIX.q('T0_board', '[data-sr="col0"] header .st'));
    }
    if (lf >= b(2) && lf < b(6) + 10) {
      const c = mineCam, dx = (1 - swapB) * W - swapC * W * 0.35;
      let id = lf < b(3) - 1 ? 'T1_mine' : lf < b(4) - 4 ? 'T2_accepted' : 'T3_progress';
      UIX.show(id, c, { dx, z: 2, opacity: 1 - swapC * 0.6 });
      if (id === 'T1_mine') pressEl(UIX.el('T1_mine', 'btnAccept'), lf, b(3) - 4);
      if (id === 'T2_accepted') {
        toastIn('T2_accepted', OUT(P(lf, b(3) - 1, 8)));
        const chip = UIX.el('T2_accepted', 'rowMai').querySelector('.st');
        over += ringAround('T2_accepted', null, c, P(lf, b(3) + 1, 4), 5, chip);        // Chờ tiếp nhận → Đã tiếp nhận
        pressEl(UIX.el('T2_accepted', 'btnProgress'), lf, b(4) - 6);
      }
      if (id === 'T3_progress') {
        dialogAnim('T3_progress', OUT(P(lf, b(4) - 4, 9)) * (1 - IN(P(lf, b(6) - 1, 6))));
        const v = Math.round(lerp(0, 40, IO(P(lf, b(4) + 5, 9))) / 5) * 5;           // slider snaps in 5 % steps
        UIX.set(UIX.el('T3_progress', 'range'), 'prop', 'value', String(v));
        UIX.set(UIX.el('T3_progress', 'out'), 'text', v + '%');
        typeInto(UIX.el('T3_progress', 'note'), 'Đã rà soát chuẩn đầu ra, đang soạn đề cương mới', P(lf, b(5) + 2, 10));
        pressEl(UIX.el('T3_progress', 'submit'), lf, b(6) - 2);
      }
      // cursor in the assignee's view
      const rg = UIX.rect('T3_progress', 'range');
      const thumb = (v) => [rg.x + 8 + (rg.w - 16) * v / 100, rg.y + rg.h / 2];
      over += cursor(lf, [
        [b(2) + 4, { s: [W * 0.85, H * 1.05] }],
        [b(3) - 5, { p: center('T1_mine', 'btnAccept') }],
        [b(3) + 2, { p: center('T1_mine', 'btnAccept') }],
        [b(4) - 7, { p: center('T2_accepted', 'btnProgress') }],
        [b(4) - 4, { p: center('T2_accepted', 'btnProgress') }],
        [b(4) + 4, { p: thumb(0) }],
        [b(4) + 5, { p: thumb(0) }],
        [b(4) + 14, { p: thumb(40) }],
        [b(5), { p: center('T3_progress', 'note', -120, 0) }],
        [b(5) + 12, { p: center('T3_progress', 'note', -120, 0) }],
        [b(6) - 3, { p: center('T3_progress', 'submit') }],
        [b(6) + 1, { p: center('T3_progress', 'submit') }],
      ], [b(3) - 4, b(4) - 6, b(4) + 5, b(5) + 1, b(6) - 2], c);
    } else L.cursor.innerHTML = '';
    if (lf >= b(6) + 1) {
      // the card flies to “Đang thực hiện” (FLIP from T0 → T5 rects); progress fills 0 → 40 %
      const fly = IO(P(lf, b(6) + 6, 11));
      const useAfter = lf >= b(7) + 3;
      const id = useAfter ? 'T5_board' : 'T0_board';
      UIX.show(id, boardCam, { dx: (1 - swapC) * W, z: 3 });
      if (!useAfter) {
        const r0 = UIX.rect('T0_board', 'card2'), r5 = UIX.rect('T5_board', 'card2');
        UIX.css(card2, { translate: `${(r5.x - r0.x) * fly}px ${(r5.y - r0.y) * fly}px`, 'z-index': '5', position: 'relative', 'box-shadow': `0 ${18 * Math.sin(Math.PI * fly)}px ${40 * Math.sin(Math.PI * fly)}px rgba(15,23,42,${0.25 * Math.sin(Math.PI * fly)})` });
        const p = Math.round(40 * OUT(P(lf, b(6) + 12, 8)));
        UIX.css(card2.querySelector('.bar b'), { width: p + '%' });
        UIX.set(card2.querySelector('.progress-cell .muted'), 'text', p + '%');
      }
      if (useAfter) over += ringAround('T5_board', null, boardCam, 1 - P(lf, b(7) + 6, 6), 5, UIX.q('T5_board', '[data-sr="col1"] header .st'));
    }
    if (lf >= b(7) + 4) {                                                   // beat 8: accent wipe out to black
      const x = lerp(-barW, W, OUT(P(lf, b(7) + 4, 10)));
      over += box(0, 0, Math.max(0, x), H, `background:${C.black}`) + box(x, 0, barW, H, `background:${C.accent}`);
    }
    return { bg: C.black, under, over };
  }

  // ---------------------------------------------------------------- DUYỆT
  function review(lf) {
    const word = T.review;
    const size = fit(word, W * 0.86, H * 0.4);
    const t = txt(word, { x: W / 2, capMid: H / 2, size, align: 'center' });
    if (lf < b(1)) return { bg: C.black, over: t.html };
    let over = '';
    const c = camPath(lf, [
      [b(1), on('R0_result', 'card', FILL * 1.45, 0, 0)],
      [b(2) + 4, on('R0_result', 'card', FILL * 1.45, 120, 0)],
      [b(3) - 3, FULL()],                                                    // the dialog opens
      [b(3) + 6, on('R1_dialog', 'pass', FILL * 1.8, 170, 60)],              // decision + comment
      [b(4) + 6, on('R1_dialog', 'pass', FILL * 1.8, 170, 60)],
      [b(4) + 6, on('R1_dialog', 'submit', FILL * 1.5, -220, -110)],
      [b(5) + 4, on('R2_done', 'card', FILL * 1.45, 0, -10)],                // result: Đạt
      [b(5) + 14, on('R2_done', 'kvProg', FILL * 1.45, 380, -10)],           // task: Hoàn thành · 100 %
      [b(6) + 10, at(FILL, 800, 450)],
    ]);
    if (lf < b(2) + 9) {
      UIX.show('R0_result', c);
      pressEl(UIX.el('R0_result', 'btnReview'), lf, b(2) + 8);
    } else if (lf < b(5)) {
      UIX.show('R1_dialog', c);
      const open = OUT(P(lf, b(2) + 9, 9)), close = P(lf, b(4) + 9, 6);
      dialogAnim('R1_dialog', open * (1 - IN(close)));
      // fields reveal one after another
      const dlg = UIX.el('R1_dialog', 'dlg');
      [dlg.querySelector('.dialog-head'), ...dlg.querySelectorAll('form > *:not([hidden])')].forEach((e, i) => {
        const r = OUT(P(lf, b(2) + 11 + i * 2, 7));
        UIX.css(e, { opacity: String(r), translate: `0 ${(1 - r) * 10}px` });
      });
      pressEl(UIX.el('R1_dialog', 'pass'), lf, b(3) + 6);
      typeInto(UIX.el('R1_dialog', 'comment'), 'Kế hoạch đầy đủ, đúng tiến độ.', P(lf, b(3) + 12, 10));
      pressEl(UIX.el('R1_dialog', 'submit'), lf, b(4) + 8);
    } else {
      UIX.show('R2_done', c, { filter: `brightness(${lerp(1, 0.25, IO(P(lf, b(6) - 2, 8)))})` });
      toastIn('R2_done', OUT(P(lf, b(5), 8)));
      over += ringAround('R2_done', null, c, P(lf, b(5) + 3, 4) * (1 - P(lf, b(5) + 12, 3)), 5, UIX.q('R2_done', '[data-sr="card"] .result-head .st'));
      const st = UIX.qa('R2_done', 'main .st').find((e) => e.textContent.includes('Hoàn thành') && e.getBoundingClientRect().top < 200);
      over += ringAround('R2_done', null, c, P(lf, b(6) - 2, 4) * (1 - P(lf, b(6) + 8, 4)), 5, st);
      const bar = UIX.q('R2_done', '[data-sr="kvProg"] .bar b');
      const p = Math.round(lerp(99, 100, P(lf, b(5) + 12, 4)));
      UIX.css(bar, { width: p + '%' }); UIX.set(UIX.q('R2_done', '[data-sr="kvProg"] dd'), 'text', p + '%');
    }
    over += cursor(lf, [
      [b(2), { s: [W * 0.9, H * 1.05] }],
      [b(2) + 7, { p: center('R0_result', 'btnReview') }],
      [b(3) - 2, { p: center('R0_result', 'btnReview') }],
      [b(3) + 5, { p: center('R1_dialog', 'pass') }],
      [b(3) + 8, { p: center('R1_dialog', 'pass') }],
      [b(3) + 11, { p: center('R1_dialog', 'comment', -100, -10) }],
      [b(4) + 3, { p: center('R1_dialog', 'comment', -100, -10) }],
      [b(4) + 7, { p: center('R1_dialog', 'submit') }],
      [b(4) + 12, { p: center('R1_dialog', 'submit') }],
    ], [b(2) + 8, b(3) + 6, b(3) + 12, b(4) + 8], c);
    if (lf < b(2)) {                                                        // beat 2: slice — halves part and leave
      const e = IO(P(lf, b(1), 13));
      const split = t.baseline - (MET.cap * size) / 2;
      const d = e * H * 0.62;
      over += `<div style="position:absolute;left:0;top:${-d}px;width:${W}px;height:${split}px;overflow:hidden">${box(0, 0, W, split, `background:${C.black}`)}${t.html}</div>`;
      over += `<div style="position:absolute;left:0;top:${split + d}px;width:${W}px;height:${H - split}px;overflow:hidden"><div style="position:absolute;left:0;top:${-split}px;width:${W}px;height:${H}px">${box(0, split, W, H - split, `background:${C.black}`)}${t.html}</div></div>`;
    }
    if (lf >= b(6) + 6) {                                                   // the three real verdicts, wiped in line by line
      const ws = T.reviewSwap;
      const longest = ws.reduce((a, w) => (width(w, 1) > width(a, 1) ? w : a));
      const s2 = Math.min(fit(longest, W * 0.8, Infinity), H * 0.25 * 0.92 / LEAD(ws));
      let lines = '';
      ws.forEach((w, i) => {
        const e = OUT(P(lf, b(6) + 6 + i * 2, 7));
        const tt = txt(w, { x: W / 2, capMid: H / 2 + (i - 1) * s2 * LEAD(ws), size: s2, align: 'center', color: i === 0 ? C.accent : C.off });
        lines += `<div style="position:absolute;inset:0;clip-path:inset(0 ${(1 - e) * 100}% 0 0)">${tt.html}</div>`;
      });
      over += box(0, 0, W, H, `background:${C.black}`) + lines;
    }
    return { bg: C.black, over };
  }

  // ---------------------------------------------------------------- THỐNG KÊ
  function measure(lf) {
    const word = T.measure;
    if (lf >= b(7)) {                                                       // beat 8: colour invert #2 + swap
      const w2 = T.measureSwap;
      const s2 = fit(w2, W * 0.86, H * 0.32);
      return { bg: C.off, over: txt(w2, { x: W / 2, capMid: H / 2, size: s2, align: 'center', color: C.black }).html };
    }
    let over = '';
    const size = fit(word, W * 0.86, H * 0.36);
    const capMid = H / 2 + (LEAD([word]) > 1 ? size * 0.12 : 0);
    // the page rises from below while the word lifts out of frame (parallax)
    const rise = IO(P(lf, b(1) + 9, 11)), riseP = IO(P(lf - 1, b(1) + 9, 11));
    {
      const chars = [...word]; let inner = '';
      const t0 = txt(word, { x: W / 2, capMid, size, align: 'center' });
      const maskTop = t0.capTop - size * 0.42, maskBot = t0.baseline + size * 0.24;
      chars.forEach((ch, i) => {                                            // letter stagger (#1)
        const e = OUT(P(lf, i, 6));
        const pre = chars.slice(0, i).join('');
        inner += txt(ch, { x: t0.left + (i ? width(pre, size) + LS * size : 0), capMid: capMid + (1 - e) * size * 1.4, size }).html;
      });
      const lift = -rise * H * 0.9, v = -(rise - riseP) * H * 0.9;
      const block = (oy, a) => `<div style="position:absolute;left:0;top:${maskTop + lift + oy}px;width:${W}px;height:${maskBot - maskTop}px;overflow:hidden;opacity:${a}"><div style="position:absolute;left:0;top:${-maskTop}px;width:${W}px;height:${H}px">${inner}</div></div>`;
      if (rise < 1) over += moving((ox, oy, a) => block(oy, a), 0, v);
    }
    if (lf < b(1) + 9) return { bg: C.black, over };
    const id = 'S1_stats';
    const c = camPath(lf, [
      [b(1) + 9, at(FILL * 1.25, 800, 300)],
      [b(2) + 8, at(FILL * 1.25, 800, 300)],
      [b(3) + 1, on(id, 'kpiDone', FILL * 1.7, 260, 20)],                   // counters flip: the task just approved
      [b(3) + 9, on(id, 'kpiDone', FILL * 1.7, 260, 20)],
      [b(4) + 2, on(id, 'donut', FILL * 1.45, 330, 0)],                     // charts draw
      [b(5) + 6, on(id, 'bars', FILL * 1.35, -160, 0)],
      [b(6) - 2, on(id, 'tableUnits', FILL * 1.35, 0, 0)],                  // unit table
      [b(6) + 8, FULL()],                                                    // whole dashboard
      [b(7), on(id, 'export', FILL * 1.25, -500, 120)],
    ]);
    UIX.show(id, c, { dy: (1 - rise) * H * 1.05 });
    const D = UIX.doc(id), B0 = UIX.doc('S_before');
    // KPI cards stagger in; numbers count up to the BEFORE values, then flip to AFTER on beat 3
    const kp = [...D.querySelectorAll('.kpi')], kb = [...B0.querySelectorAll('.kpi')];
    const flip = lf >= b(3) + 1;
    kp.forEach((card, i) => {
      const e = OUT(P(lf, b(1) + 14 + i * 2, 8));
      UIX.css(card, { opacity: String(e), translate: `0 ${(1 - e) * 22}px` });
      const sEl = card.querySelector('strong'), bEl = kb[i].querySelector('strong');
      const after = sEl.textContent, before = bEl.textContent;
      if (!flip) {
        const n = parseFloat(before), cnt = OUT(P(lf, b(1) + 15 + i * 2, 12));
        UIX.set(sEl, 'text', before.replace(/[\d.]+/, String(Math.round(n * cnt))));
        UIX.set(card.querySelector('small'), 'text', kb[i].querySelector('small').textContent);
      } else if (after !== before) {
        const pop = P(lf, b(3) + 1, 5);
        UIX.css(sEl, { color: C.accent, scale: String(lerp(1.25, 1, OUT(pop))), display: 'inline-block', 'transform-origin': 'left center' });
      }
    });
    if (flip) {
      const changed = kp.filter((card, i) => card.querySelector('strong').textContent !== kb[i].querySelector('strong').textContent);
      changed.forEach((card) => { over += ringAround(id, null, c, P(lf, b(3) + 1, 4) * (1 - P(lf, b(3) + 12, 4)), 4, card); });
    }
    // donut: segments sweep round in order; centre % counts
    const sweep = IO(P(lf, b(3) + 10, 14));
    const circ = 2 * Math.PI * 54;
    D.querySelectorAll('.donut circle').forEach((ci) => {
      const len = parseFloat(ci.getAttribute('stroke-dasharray')), start = -parseFloat(ci.getAttribute('stroke-dashoffset'));
      const vis = clamp(sweep * circ - start, 0, len);
      UIX.set(ci, 'attr', 'stroke-dasharray', `${vis} ${circ - vis}`);
    });
    const ctr = D.querySelector('.donut span b');
    UIX.set(ctr, 'text', Math.round(parseFloat(ctr.textContent) * sweep) + '%');
    D.querySelectorAll('.legend li').forEach((li, i) => { const e = OUT(P(lf, b(3) + 12 + i * 2, 7)); UIX.css(li, { opacity: String(e), translate: `${(1 - e) * 14}px 0` }); });
    // bars grow month by month, labels arrive with them; gridline draws
    D.querySelectorAll('.bar-col').forEach((col, i) => {
      const e = OUT(P(lf, b(4) + 4 + i * 1.2, 9));
      col.querySelectorAll('.b').forEach((bb) => {
        const h = parseFloat(bb.getAttribute('style').match(/height:\s*([\d.]+)%/)[1]);
        UIX.css(bb, { height: h * e + '%' });
        UIX.css(bb.querySelector('em'), { opacity: String(clamp(e * 2 - 1)) });
      });
      UIX.css(col.querySelector('small'), { opacity: String(clamp(e * 3)) });
    });
    // unit table: rows slide in, on-time bars fill
    D.querySelectorAll('[data-sr="tableUnits"] tbody tr').forEach((tr, i) => {
      const e = OUT(P(lf, b(5) + 2 + i * 3, 8));
      UIX.css(tr, { opacity: String(e) });
      const bb = tr.querySelector('.bar b');
      if (bb) UIX.css(bb, { width: parseFloat(bb.style.width) * OUT(P(lf, b(5) + 5 + i * 3, 10)) + '%' });
    });
    // cursor → Xuất Excel (pressed; the export itself is a file download — nothing invented on screen)
    over += cursor(lf, [
      [b(6) + 4, { s: [W * 0.95, H * 0.95] }],
      [b(6) + 13, { p: center(id, 'export') }],
      [b(7), { p: center(id, 'export') }],
    ], [b(6) + 13], c);
    pressEl(UIX.el(id, 'export'), lf, b(6) + 13);
    return { bg: C.black, over };
  }

  // ---------------------------------------------------------------- COLLAGE → IDENTITY
  // Three layers: low-contrast giant rows (back), secondary words drifting the other way
  // (middle), one dominant keyword (front) that swaps on the beat, then on half-beats.
  function build(lf) {
    const words = T.marquee, sec = T.secondary;
    const collapseAt = b(5);
    const ce = IN(P(lf, collapseAt, 9));
    const t = lf;
    let under = '', over = '';
    // back layer
    const bigRows = 4, rowH = H / bigRows, bs = (rowH * 0.78) / MET.cap;
    for (let r = 0; r < bigRows; r++) {
      const w = words[(r + 1) % words.length], uw = width(w, bs) + bs * 0.4, dir = r % 2 ? 1 : -1;
      let off = (dir * (W * 0.004 * t + W * 0.00012 * t * t)) % uw; if (off > 0) off -= uw;
      const y = lerp(rowH * (r + 0.5), H / 2, ce);
      let row = '';
      for (let i = 0; i < Math.ceil(W / uw) + 2; i++) row += txt(w, { x: off + i * uw, capMid: y, size: bs, color: C.off, style: 'opacity:.08' }).html;
      under += `<div style="position:absolute;inset:0;transform:scaleY(${1 - ce});transform-origin:50% ${H / 2}px">${row}</div>`;
    }
    // middle layer
    const ms = H * 0.06;
    [0.22, 0.78].forEach((fy, r) => {
      const line = sec.join('   ·   ') + '   ·   ', uw = width(line, ms, 900, 0.02), dir = r ? -1 : 1;
      let off = (dir * (W * 0.012 * t + W * 0.0003 * t * t)) % uw; if (off > 0) off -= uw;
      const y = lerp(H * fy, H / 2, ce);
      let row = '';
      for (let i = 0; i < Math.ceil(W / uw) + 2; i++) row += txt(line, { x: off + i * uw, capMid: y, size: ms, ls: 0.02, color: C.off, style: 'opacity:.45' }).html;
      over += `<div style="position:absolute;inset:0;transform:scaleY(${1 - ce});transform-origin:50% ${H / 2}px">${row}</div>`;
    });
    // front: dominant keyword (beat swaps → half-beat swaps), then HUIT
    const cuts = [0, 13, 24, 34, 44, 54, 64];                             // swaps accelerate, every word still ≥ 10 f
    const step = cuts.filter((x) => lf >= x).length - 1;
    if (lf < collapseAt) {
      const w = words[step % words.length];
      const s = Math.min(fit(w, W * 0.74, Infinity), H * 0.24);
      over += box(0, H / 2 - s * 0.62, W, s * 1.24, `background:${C.black}`);       // clear band so the hero reads
      over += txt(w, { x: W / 2, capMid: H / 2, size: s, align: 'center', color: step % 2 ? C.off : C.accent }).html;
    } else {
      const lk = lockGeom();
      over += box(0, H / 2 - lk.size * 0.7, W, lk.size * 1.4, `background:${C.black};opacity:${ce}`);
      const e = OUT(P(lf, collapseAt + 2, 8));
      over += `<div style="position:absolute;inset:0;clip-path:inset(${(1 - e) * 50}% 0 ${(1 - e) * 50}% 0)">${lk.t.html}</div>`;
    }
    return { bg: C.black, under, over };
  }

  // Lockup: HUIT + the thesis title as ONE name block, so the frame reads as a student thesis
  // project, not as an official university product. build() match-cuts into the HUIT part.
  function lockGeom() {
    const [a, z] = T.product;
    const name = a + z;
    const size = fit(name, W * 0.42, H * 0.2);
    const t = txt(name, { x: W / 2, capMid: H * 0.36, size, align: 'center', ls: -0.04, html: `${esc(a)}<span style="color:${C.accent}">${esc(z)}</span>` });
    // title set to the width of the name block (the longer line spans ~1.25× the word HUIT)
    const lines = T.end.titleLines;
    const ts = Math.min(H * 0.05, ...lines.map((l) => fit(l, Math.max(t.w * 1.25, W * 0.5), Infinity)));
    return { size, t, lines, ts };
  }
  const maskRise = (html, top, h, e) =>                      // line-mask rise: text slides up inside its own line box
    `<div style="position:absolute;left:0;top:${top}px;width:${W}px;height:${h}px;overflow:hidden"><div style="position:absolute;left:0;top:${-top + (1 - e) * h}px;width:${W}px;height:${H}px">${html}</div></div>`;
  function lockup(lf) {
    const { size, t, lines, ts } = lockGeom();
    const small = Math.max(24, Math.round(H * 0.026));
    const ownEntrance = !R.S.build;                          // short cut: no collage before → slit-reveal the name here
    const t0 = ownEntrance ? 10 : 4;
    let out = '';
    if (ownEntrance) { const e = OUT(P(lf, 0, 9)); out += `<div style="position:absolute;inset:0;clip-path:inset(${(1 - e) * 50}% 0 ${(1 - e) * 50}% 0)">${t.html}</div>`; }
    else out += t.html;                                       // dead still (continues the match cut)
    // kicker above the name: what this is
    const kick = `${T.end.kind} · ${R.THESIS.code}`.toUpperCase();
    const kb = t.capTop - small * 1.6;
    out += txt(kick, { x: W / 2, baseline: kb, size: small, weight: 500, ls: 0.08, align: 'center', style: `opacity:${0.6 * OUT(P(lf, t0, 10))}` }).html;
    // the title, part of the name block: thin rule + two lines rising in on a 3-frame stagger
    const ruleY = t.baseline + size * 0.2, rw = t.w * 0.5 * OUT(P(lf, t0, 10));
    out += box(W / 2 - rw / 2, ruleY, rw, Math.max(2, Math.round(H * 0.003)), `background:${C.accent}`);
    let y = ruleY + ts * 1.75;
    lines.forEach((l, i) => {
      const r = txt(l, { x: W / 2, baseline: y, size: ts, weight: 900, ls: -0.01, align: 'center' });
      out += maskRise(r.html, y - ts * 1.25, ts * 1.6, IO(P(lf, t0 + 2 + i * 3, 10)));
      y += ts * 1.25;
    });
    out += txt(T.closing, { x: W / 2, baseline: y + small * 2.4, size: Math.round(small * 1.2), weight: 500, align: 'center', color: C.accent, style: `opacity:${OUT(P(lf, b(2) + (ownEntrance ? 6 : 0), 14))}` }).html;
    return { bg: C.black, over: out };
  }

  function endcard(lf) {
    const R2 = R.THESIS, e = T.end;
    const big = Math.round(H * 0.1), mid = Math.round(H * 0.044), sm = Math.max(22, Math.round(H * 0.027));
    let y = H * 0.27, out = '';
    const reveal = (i) => OUT(P(lf, 2 + i * 3, 10));
    const line = (i, html) => `<div style="opacity:${reveal(i)};transform:translateY(${(1 - reveal(i)) * 10}px)">${html}</div>`;
    out += line(0, txt(T.product.join(''), { x: M, baseline: y, size: big, ls: -0.04, html: `${esc(T.product[0])}<span style="color:${C.accent}">${esc(T.product[1])}</span>` }).html);
    y += big * 0.55;
    out += line(0, box(M, y, W - 2 * M, 2, `background:${C.off};opacity:.3`));
    y += mid * 1.7;
    out += line(1, txt([e.kind, R2.code].filter(Boolean).join(' · ').toUpperCase(), { x: M, baseline: y, size: sm, weight: 500, ls: 0.08, style: 'opacity:.6' }).html);
    y += mid * 1.5;
    e.titleLines.forEach((l) => { out += line(2, txt(l, { x: M, baseline: y, size: mid, weight: 900, ls: -0.01 }).html); y += mid * 1.22; });
    y += mid * 0.5;
    const uni = typeof R2.university === 'object' ? R2.university[LANG] : R2.university;
    out += line(3, txt([e.faculty, uni, R2.year].filter(Boolean).join(' · '), { x: M, baseline: y, size: sm, weight: 500, ls: 0 }).html);
    y += sm * 2.6;
    // two columns: students (name · student ID) | supervisor. Empty fields are not drawn.
    const studs = (R2.students || []).filter(([n]) => n);
    const c2 = M + W * 0.5;
    if (studs.length) {
      out += line(4, txt(e.studentLabel, { x: M, baseline: y, size: sm, weight: 500, ls: 0, style: 'opacity:.6' }).html);
      studs.forEach(([n, id], i) => out += line(4 + i * 0.5, txt(n, { x: M, baseline: y + sm * 1.7 * (i + 1), size: sm, weight: 900, ls: 0 }).html +
        (id ? txt(id, { x: M + W * 0.24, baseline: y + sm * 1.7 * (i + 1), size: sm, weight: 500, ls: 0.02, style: 'opacity:.75' }).html : '')));
    }
    if (R2.supervisor) {
      out += line(5, txt(e.supervisorLabel, { x: c2, baseline: y, size: sm, weight: 500, ls: 0, style: 'opacity:.6' }).html);
      out += line(5, txt(R2.supervisor, { x: c2, baseline: y + sm * 1.7, size: sm, weight: 900, ls: 0 }).html);
    }
    out += line(6, txt(e.demo, { x: M, baseline: H - M * 0.8, size: Math.round(sm * 0.8), weight: 500, ls: 0.02, style: 'opacity:.45' }).html);
    return { bg: C.black, over: out };
  }

  // ======================= v3: NEW INTERACTION SCENES =========================
  // Small shared pieces
  const blackCurtainDown = (lf, start, dur = 9) => { const e = IO(P(lf, start, dur)); return e > 0 ? box(0, 0, W, H * e, `background:${C.black}`) : ''; };
  const riseIn = (lf, start, dur = 11) => (1 - IO(P(lf, start, dur))) * H * 1.05;

  // ---------------------------------------------------------------- TẠO VIỆC (from a template)
  function create(lf) {
    const word = T.create;
    const size = fit(word, W * 0.8, H * 0.36);
    let over = '';
    // typewriter: characters land 1.5 f apart behind an accent caret (word holds to f 22)
    if (lf < 34) {
      const n = Math.min(word.length, Math.floor(lf / 1.5) + 1);
      const shown = word.slice(0, n);
      const t = txt(word, { x: W / 2, capMid: H / 2, size, align: 'center' });
      const lift = -IO(P(lf, 22, 11)) * H * 0.9, lp = -IO(P(lf - 1, 22, 11)) * H * 0.9;
      const make = (ox, oy, a) => txt(shown, { x: t.left, capMid: H / 2 + lift + oy, size, style: `opacity:${a}` }).html +
        ((lf < 22 && Math.floor(lf / 4) % 2 === 0) || n < word.length ? box(t.left + width(shown, size) + size * 0.06, H / 2 + lift - MET.cap * size / 2, size * 0.09, MET.cap * size, `background:${C.accent}`) : '');
      over += moving(make, 0, lift - lp);
    }
    if (lf < 22) return { bg: C.black, over };
    const c = camPath(lf, [
      [22, on('C0_create', 'btnTpl', FILL * 1.35, -420, 140)],
      [44, on('C0_create', 'btnTpl', FILL * 1.45, -300, 120)],
      [52, on('C1_tpl', 'tplItem', FILL * 1.9, 0, 0)],
      [62, on('C1_tpl', 'tplItem', FILL * 1.9, 0, 0)],
      [72, on('C2_filled', 'titleIn', FILL * 1.45, 0, 120)],
      [86, on('C2_filled', 'cat', FILL * 1.45, 220, 40)],
      [96, on('C2_filled', 'submit', FILL * 1.45, -380, -200)],
      [108, on('C3_created', 'title', FILL * 1.4, 300, 60)],
    ]);
    const dy = riseIn(lf, 22);
    if (lf < 44) { UIX.show('C0_create', c, { dy }); pressEl(UIX.el('C0_create', 'btnTpl'), lf, 42); }
    else if (lf < 62) {
      UIX.show('C1_tpl', c);
      dialogAnim('C1_tpl', OUT(P(lf, 44, 9)) * (1 - IN(P(lf, 57, 5))));
      pressEl(UIX.el('C1_tpl', 'tplItem'), lf, 56);
    } else if (lf < 97) {
      UIX.show('C2_filled', c);
      const D = UIX.doc('C2_filled');
      const ti = UIX.el('C2_filled', 'titleIn');
      typeInto(ti, ti.value, P(lf, 62, 10));                                  // the template's title types in
      // the other fields fill one after another, each with an accent flash
      [...D.querySelectorAll('main textarea, main select, main input[type=date], main .seg')].forEach((e, i) => {
        const tt = lf - (64 + i * 3);
        if (tt < 0 && e.tagName !== 'DIV') UIX.css(e, { color: 'transparent' });
        if (tt >= 0 && tt < 8) UIX.css(e, { 'box-shadow': `0 0 0 ${3 * (1 - tt / 8)}px ${C.accent}` });
      });
      pressEl(UIX.el('C2_filled', 'submit'), lf, 92);
    } else {
      UIX.show('C3_created', c);
      toastIn('C3_created', OUT(P(lf, 97, 8)));
      over += ringAround('C3_created', 'title', c, P(lf, 99, 4), 8);
    }
    over += cursor(lf, [
      [30, { s: [W * 0.9, H * 1.05] }],
      [40, { p: center('C0_create', 'btnTpl') }],
      [46, { p: center('C0_create', 'btnTpl') }],
      [54, { p: center('C1_tpl', 'tplItem', -120, 0) }],
      [62, { p: center('C1_tpl', 'tplItem', -120, 0) }],
      [86, { p: center('C2_filled', 'submit') }],
      [96, { p: center('C2_filled', 'submit') }],
    ], [42, 56, 92], c);
    over += blackCurtainDown(lf, 110);
    return { bg: C.black, over };
  }

  // ---------------------------------------------------------------- THÔNG BÁO + cảnh báo hạn
  function notify(lf) {
    const word = T.notify;
    let over = '';
    if (lf < 30) {                                                          // tracking collapses: wide → tight
      const e = OUT(P(lf, 0, 12));
      const ls = lerp(0.6, LS, e);
      const size = fit(word, W * 0.84, H * 0.36) * 0.98;
      const xo = -IO(P(lf, 22, 8)) * W * 1.1, xp = -IO(P(lf - 1, 22, 8)) * W * 1.1;
      over += moving((ox, oy, a) => txt(word, { x: W / 2 + xo + ox, capMid: H / 2, size, align: 'center', ls, style: `opacity:${a * clamp(e * 2)}` }).html, xo - xp, 0);
    }
    if (lf < 22) return { bg: C.black, over };
    // Phạm Thái Bảo (just assigned) — the bell
    const swap = IO(P(lf, 57, 9));
    if (lf < 66) {
      const c = camPath(lf, [[22, FULL()], [34, on('B0_home', 'bell', FILL * 1.4, -420, 260)], [57, on('B1_bell', 'drop', FILL * 1.55, -80, 30)]]);
      const id = lf < 45 ? 'B0_home' : 'B1_bell';
      UIX.show(id, c, { dx: (1 - IO(P(lf, 22, 10))) * W - swap * W * 0.35, opacity: 1 - swap * 0.6 });
      if (id === 'B0_home') {
        const pulse = P(lf, 32, 10);
        over += ringAround('B0_home', 'badge', c, Math.sin(Math.PI * pulse), 4);
      } else {
        const d = OUT(P(lf, 45, 7));
        UIX.css(UIX.el('B1_bell', 'drop'), { opacity: String(d), translate: `0 ${(1 - d) * -10}px` });
        over += ringAround('B1_bell', 'noti0', c, P(lf, 50, 4), 4);
      }
      over += cursor(lf, [[30, { s: [W * 0.6, H * 1.05] }], [42, { p: center('B0_home', 'bell') }], [56, { p: center('B0_home', 'bell', 40, 60) }]], [44], c);
    }
    // Lê Thị Mai — the deadline pop-up after login
    if (lf >= 57) {
      const c = camPath(lf, [[57, FULL()], [70, on('N0_alert', 'item', FILL * 1.7, 0, 20)], [92, on('N0_alert', 'item', FILL * 1.7, 0, 20)],
        [104, on('N0_alert', 'item', FILL * 2.4, 0, 0)], [119, on('N0_alert', 'item', FILL * 6, -120, 0)]]);
      UIX.show('N0_alert', c, { dx: (1 - swap) * W, z: 2 });
      dialogAnim('N0_alert', OUT(P(lf, 62, 10)));
      over += ringAround('N0_alert', 'when', c, P(lf, 74, 4) * (1 - P(lf, 92, 4)), 4);
      pressEl(UIX.el('N0_alert', 'item'), lf, 96);
      if (lf >= 66) over += cursor(lf, [[66, { s: [W * 0.85, H * 1.05] }], [92, { p: center('N0_alert', 'item', -160, 0) }], [100, { p: center('N0_alert', 'item', -160, 0) }]], [96], c);
      if (lf >= 108) over += box(0, 0, W, H, `background:${C.black};opacity:${IO(P(lf, 108, 11))}`);   // push-through into the task
    }
    return { bg: C.black, over };
  }

  // ---------------------------------------------------------------- GIA HẠN
  function extend(lf) {
    const word = T.extend;
    const size = fit(word, W * 0.84, H * 0.36);
    let over = '';
    if (lf < 36) {                                                          // the word stretches out to full width
      const e = OUT(P(lf, 0, 10));
      const dy = -IO(P(lf, 24, 11)) * H, dp = -IO(P(lf - 1, 24, 11)) * H;
      over += moving((ox, oy, a) => txt(word, { x: W / 2, capMid: H / 2 + dy + oy, size, align: 'center', transform: `scaleX(${lerp(0.35, 1, e)})`, style: `opacity:${a}` }).html, 0, dy - dp);
    }
    if (lf < 24) return { bg: C.black, over };
    const c = camPath(lf, [
      [24, on('X0_ext', 'row', FILL * 1.45, 0, 40)],
      [36, on('X0_ext', 'row', FILL * 1.45, 220, 40)],
      [50, on('X1_dialog', 'compare', FILL * 2.0, 0, 30)],
      [64, on('X1_dialog', 'approve', FILL * 1.8, 180, -30)],
      [82, on('X1_dialog', 'submit', FILL * 1.5, -260, -160)],
      [92, on('X2_done', 'kvDue', FILL * 1.6, 240, 0)],
      [106, on('X2_done', 'row', FILL * 1.45, 0, -40)],
    ]);
    if (lf < 41) {
      UIX.show('X0_ext', c, { dy: riseIn(lf, 24) });
      const late = UIX.qa('X0_ext', '[data-sr="row"] *').find((e) => e.children.length === 0 && /trễ/.test(e.textContent));
      if (late) over += ringAround('X0_ext', null, c, P(lf, 26, 4), 4, late);
      pressEl(UIX.el('X0_ext', 'btnExt'), lf, 40);
    } else if (lf < 88) {
      UIX.show('X1_dialog', c);
      dialogAnim('X1_dialog', OUT(P(lf, 41, 9)) * (1 - IN(P(lf, 81, 6))));
      pressEl(UIX.el('X1_dialog', 'approve'), lf, 62);
      pressEl(UIX.el('X1_dialog', 'submit'), lf, 80);
    } else {
      UIX.show('X2_done', c);
      toastIn('X2_done', OUT(P(lf, 88, 8)));
      over += ringAround('X2_done', 'kvDue', c, P(lf, 92, 4) * (1 - P(lf, 100, 3)), 4);
      over += ringAround('X2_done', 'row', c, P(lf, 103, 4), 4);
    }
    over += cursor(lf, [
      [26, { s: [W * 0.9, H * 1.05] }], [38, { p: center('X0_ext', 'btnExt') }], [44, { p: center('X0_ext', 'btnExt') }],
      [58, { p: center('X1_dialog', 'approve') }], [66, { p: center('X1_dialog', 'approve') }], [78, { p: center('X1_dialog', 'submit') }], [86, { p: center('X1_dialog', 'submit') }],
    ], [40, 62, 80], c);
    over += blackCurtainDown(lf, 110);
    return { bg: C.black, over };
  }

  // ======================= v3: EMPHASIS LAYER ================================
  // spotlight (dim everything but the element being used) · numbered step captions ·
  // big type echoes of the key value. Driven by tables, in action time, mapped to section time.
  const SPOT = {
    create:  [[40, 44, 'C0_create', 'btnTpl'], [50, 58, 'C1_tpl', 'tplItem'], [86, 96, 'C2_filled', 'submit']],
    assign:  [[34, 44, 'A0_detail', 'btnAssign'], [62, 72, 'A1_dialog', 'rowBao'], [73, 82, 'A1_dialog', () => UIX.el('A1_dialog', 'roleLead').parentElement], [83, 88, 'A1_dialog', 'submit'], [95, 100, 'A3_done', 'kvAssign']],
    notify:  [[46, 57, 'B1_bell', 'drop'], [70, 104, 'N0_alert', 'item']],
    track:   [[24, 30, 'T0_board', 'card2'], [36, 44, 'T1_mine', 'btnAccept'], [45, 54, 'T2_accepted', () => UIX.el('T2_accepted', 'rowMai').querySelector('.st')], [64, 75, 'T3_progress', 'range'], [76, 88, 'T3_progress', 'note']],
    extend:  [[22, 38, 'X0_ext', 'row'], [46, 58, 'X1_dialog', 'compare'], [59, 66, 'X1_dialog', () => UIX.el('X1_dialog', 'approve').parentElement], [92, 102, 'X2_done', 'kvDue']],
    review:  [[32, 39, 'R0_result', 'btnReview'], [48, 56, 'R1_dialog', () => UIX.el('R1_dialog', 'pass').parentElement], [56, 67, 'R1_dialog', 'comment'], [76, 86, 'R2_done', 'card']],
    measure: [[46, 55, 'S1_stats', 'kpis'], [56, 64, 'S1_stats', 'donut'], [65, 77, 'S1_stats', 'bars'], [78, 92, 'S1_stats', 'tableUnits'], [96, 104, 'S1_stats', 'export']],
  };
  const ECHO = {
    track:   [64, 92, (af) => Math.round(lerp(0, 40, IO(P(af, 65, 9))) / 5) * 5 + '%'],
    extend:  [48, 70, () => '+9 ' + T.echo.days],
    measure: [46, 62, () => '1 → 2'],
    notify:  [72, 92, () => '2 ' + T.echo.days],
  };
  function spotRect(id, target) {
    const e = typeof target === 'function' ? target() : UIX.el(id, target);
    return e ? UIX.rectOf(id, e) : null;
  }
  function emphasis(sec, lf) {
    let html = '';
    const af = R.toAction(sec, lf);
    // spotlight — eased in/out over 5 action frames, follows the camera of that state
    let hole = null;
    for (const [a, z, id, target] of SPOT[sec] || []) {
      const e = Math.min(P(af, a, 4), 1 - P(af, z - 3, 3));
      const cam = UIX.camOf(id);
      if (e > 0 && cam) {
        const r = spotRect(id, target); if (!r) continue;
        const pad = 12;
        const [x0, y0] = toS(cam.c, r.x - pad, r.y - pad), [x1, y1] = toS(cam.c, r.x + r.w + pad, r.y + r.h + pad);
        hole = { x0: x0 + cam.dx, y0: y0 + cam.dy, x1: x1 + cam.dx, y1: y1 + cam.dy, e, rad: 14 * cam.c.s };
      }
    }
    if (hole) {
      const id = 'sp' + Math.round(lf);
      html += `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0"><defs><filter id="${id}f"><feGaussianBlur stdDeviation="${10 * U}"/></filter>` +
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="white"/>` +
        `<rect x="${hole.x0}" y="${hole.y0}" width="${hole.x1 - hole.x0}" height="${hole.y1 - hole.y0}" rx="${hole.rad}" fill="black" filter="url(#${id}f)"/></mask></defs>` +
        `<rect width="${W}" height="${H}" fill="${C.black}" opacity="${0.55 * hole.e}" mask="url(#${id})"/></svg>`;
    }
    // big type echo of the value being changed — ONE fixed slot in every scene: bottom-right,
    // same cap height, on a black slab (mirrors the step caption top-left). Wipes in from the right.
    const ec = ECHO[sec];
    if (ec && af >= ec[0] && af < ec[1]) {
      const e = Math.min(OUT(P(af, ec[0], 5)), 1 - P(af, ec[1] - 3, 3));
      const str = ec[2](af);
      const s = Math.round(H * 0.085), pad = Math.round(s * 0.3);
      const tw = width(str, s), x1 = W - M, y1 = H - M * 0.6;          // slab's outer corner
      const bw = tw + 2 * pad, bh = MET.cap * s + 2 * pad;
      html += `<div style="position:absolute;inset:0;opacity:${e};clip-path:inset(0 0 0 ${x1 - bw * e}px)">` +
        box(x1 - bw, y1 - bh, bw, bh, `background:${C.black}`) + box(x1 - bw, y1 - bh, Math.round(H * 0.006), bh, `background:${C.accent}`) +
        txt(str, { x: x1 - pad, capMid: y1 - bh / 2, size: s, align: 'right', color: C.accent }).html + '</div>';
    }
    // numbered step captions (bottom-left), clipped in from the left on each new step
    const cap = R.CAPTIONS[sec];
    if (cap) {
      const steps = cap.steps;
      let k = -1;
      steps.forEach(([f], i) => { if (af >= f) k = i; });
      if (k >= 0 && af < cap.end) {
        const [f, vi, en] = steps[k];
        const label = (LANG === 'vi' ? vi : en).toUpperCase();
        const start = R.toSection(sec, f), e = OUT(P(lf, start, 7)), out = P(af, cap.end - 3, 3);
        const ts = Math.round(H * 0.03), hgt = Math.round(H * 0.064), num = String(k + 1).padStart(2, '0');
        const nw = hgt, lw = width(label, ts, 900, 0.02) + ts * 1.4;
        const x0 = M, y0 = M * 0.6;                                         // top-left: the app header is the least important strip
        html += `<div style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;opacity:${1 - out};clip-path:inset(0 ${W - (x0 + (nw + lw) * e)}px 0 0)">` +
          box(x0, y0, nw, hgt, `background:${C.accent}`) +
          txt(num, { x: x0 + nw / 2, capMid: y0 + hgt / 2, size: ts, weight: 900, ls: 0, align: 'center', color: '#fff' }).html +
          box(x0 + nw, y0, lw, hgt, `background:${C.black}`) +
          txt(label, { x: x0 + nw + ts * 0.7, capMid: y0 + hgt / 2, size: ts, weight: 900, ls: 0.02, color: C.off }).html + '</div>';
      }
    }
    return html;
  }

  const ORDER = [['hook', hook], ['tension', tension], ['create', create], ['assign', assign], ['notify', notify], ['track', track],
    ['extend', extend], ['review', review], ['measure', measure], ['build', build], ['lockup', lockup], ['endcard', endcard]];
  function sceneAt(f) {
    const live = ORDER.filter(([k]) => R.S[k]);                              // the short cut skips sections
    for (const [k, fn] of live) { const s = R.S[k]; if (f >= b(s.from) && f < b(s.to)) return [k, fn, f - b(s.from)]; }
    const [k, fn] = live[live.length - 1]; return [k, fn, b(R.S[k].to - R.S[k].from) - 1];
  }

  // diacritic stress test (?test=diacritics)
  function diacritics() {
    const lines = ['ƯƠỆỮẶ', 'DUYỆT ĐẠT'];
    const size = Math.min(fit(lines[0], W * 0.86, H * 0.4), fit(lines[1], W * 0.86, H * 0.4));
    let out = '';
    lines.forEach((l, i) => {
      const t = txt(l, { x: W / 2, capMid: H * 0.36 + i * size * 0.9, size, align: 'center' });
      out += box(t.left, t.top, t.w, size, `outline:2px solid ${C.accent}`) + t.html;
    });
    return { bg: C.black, over: out };
  }

  window.renderFrame = async (f) => {
    if (!MET) metrics();
    UIX.begin();
    L.cursor.innerHTML = ''; mbN = 0;
    const [k, fn, lf] = q.get('test') === 'diacritics' ? ['test', diacritics, 0] : sceneAt(f);
    // warped scenes run on their action clock; the emphasis layer runs on real (section) time
    const r = fn(R.WARPED(k) ? R.toAction(k, lf) : lf);
    if (R.CAPTIONS[k]) r.over = emphasis(k, lf) + (r.over || '');
    stage.style.background = r.bg;
    L.under.innerHTML = r.under || '';
    L.over.innerHTML = r.over || '';
    // let the iframes lay out the mutated DOM before the screenshot
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { scene: k, lf };
  };
  window.reelReady = (async () => {
    await document.fonts.load('900 100px "Be Vietnam Pro"', 'ƯƠỆỮẶ TASKS');
    await document.fonts.load('500 100px "Be Vietnam Pro"', 'ƯƠỆỮẶ Student');
    await document.fonts.ready;
    metrics();
    await UIX.load();
    return { W, H, LANG, frames: R.TOTAL_FRAMES, fps: R.FPS };
  })();
  if (q.get('f')) window.reelReady.then(() => window.renderFrame(+q.get('f')));
})();
