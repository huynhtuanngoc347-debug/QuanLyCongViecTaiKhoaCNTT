// Capture the REAL React UI as static, replayable DOM states.
// Drives the actual web app (apps/web) against the mock API exactly like a user would,
// then freezes the rendered DOM of each step into app/states/<id>.html. The showreel
// loads these in iframes with the app's own CSS and animates them frame by frame.
//
//   1) start the mock API with fresh data:  node tools/mock-api-showreel.mjs   (http://localhost:5199)
//      (copy of tools/mock-api.mjs; two [showreel] patches mirror the real API: auto-close on the last
//       'Đạt' review, and unit statistics computed from the demo tasks instead of fixed numbers.
//       It must sit in the repo's tools/ folder so it can serve apps/web/dist.)
//   2) node tools/capture-states.mjs [baseUrl]
//
// Every state is produced by real clicks/typing in the real app — nothing is drawn by hand.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'app', 'states');
mkdirSync(OUT, { recursive: true });
const B = process.argv[2] || 'http://localhost:5199/';
const PASS = 'Demo@CNTT2026!';
const VIEW = { width: 1600, height: 900 };

const browser = await chromium.launch();
async function login(email) {
  const ctx = await browser.newContext({ viewport: VIEW, locale: 'vi-VN' });
  const p = await ctx.newPage();
  await p.request.post(B + 'api/auth/login', { data: { email, password: PASS } });
  return p;
}
const settle = (p, ms = 900) => p.waitForTimeout(ms);
async function go(p, hash) {
  await p.goto(B + '#/' + hash); await settle(p, 1300);
  if (await p.$('dialog.due-alert[open]')) { await p.keyboard.press('Escape'); await settle(p, 400); }
}

// mark elements so the showreel can find them inside the frozen DOM: data-sr="<key>"
async function mark(p, marks) {
  await p.evaluate((marks) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const [key, sel, text, up] of marks) {
      let els = [...document.querySelectorAll(sel)].filter(vis);
      if (text) els = els.filter((e) => e.textContent.replace(/\s+/g, ' ').trim().includes(text));
      // prefer the innermost match
      els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
      let el = els[0];
      if (!el) { console.warn('mark not found', key); continue; }
      if (up) el = el.closest(up) || el;
      el.setAttribute('data-sr', key);
    }
  }, marks);
}

async function snap(p, id, marks = []) {
  await mark(p, marks);
  const html = await p.evaluate(() => {
    // reflect live form state into attributes so the frozen DOM shows it
    document.querySelectorAll('input').forEach((i) => {
      if (i.type === 'checkbox' || i.type === 'radio') i.checked ? i.setAttribute('checked', '') : i.removeAttribute('checked');
      else i.setAttribute('value', i.value);
    });
    document.querySelectorAll('textarea').forEach((t) => { t.textContent = t.value; });
    document.querySelectorAll('select').forEach((s) => [...s.options].forEach((o) => (o.selected ? o.setAttribute('selected', '') : o.removeAttribute('selected'))));
    // modal <dialog>s live in the top layer: pin them where they were, add their ::backdrop
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const info = dialogs.map((d, i) => {
      const r = d.getBoundingClientRect(); const bd = getComputedStyle(d, '::backdrop');
      return { i, r, bg: bd.backgroundColor, bf: bd.backdropFilter };
    });
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('script, noscript, link[rel=modulepreload]').forEach((e) => e.remove());
    const cd = [...doc.querySelectorAll('dialog[open]')];
    cd.forEach((d, i) => {
      const { r, bg, bf } = info[i];
      d.setAttribute('style', `position:fixed;inset:auto;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;max-width:none;max-height:none;z-index:${1001 + i * 2}`);
      d.setAttribute('data-sr-dialog', String(i));
      const back = document.createElement('div');
      back.setAttribute('data-sr', 'backdrop' + (i ? i : ''));
      back.setAttribute('style', `position:fixed;inset:0;background:${bg};backdrop-filter:${bf === 'none' ? 'none' : bf};z-index:${1000 + i * 2}`);
      d.before(back);
    });
    const head = doc.querySelector('head');
    head.innerHTML = '<meta charset="utf-8"><base href="../">' +
      '<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="' + [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href')).find((h) => h.includes('assets/')).replace(/^\.\//, '') + '">' +
      // frozen: no CSS motion of its own, no caret, no scrollbars — the showreel drives all motion
      '<style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html,body{overflow:hidden!important;scrollbar-width:none}' +
      '.rv{opacity:1!important;transform:none!important}</style>';
    return '<!doctype html>\n' + doc.outerHTML;
  });
  writeFileSync(path.join(OUT, id + '.html'), html);
  await p.screenshot({ path: path.join(OUT, id + '.ref.png') });   // reference image for alignment checks
  console.log('state', id);
}

const KANBAN_TITLES = ['Xây dựng đề cương học phần Học máy', 'Tư vấn tuyển sinh thạc sĩ đợt 2', 'Cập nhật chương trình đào tạo CNTT 2026', 'Tổ chức hội thảo Khoa học dữ liệu 2026', 'Báo cáo tổng kết học kỳ'];
const kanbanMarks = () => [
  ...KANBAN_TITLES.map((t, i) => [`card${i}`, '.kanban-col *', t, '.kanban-card, .kanban-col article, .kanban-col li, .kanban-col a.card']),
  ...['Chưa bắt đầu', 'Đang thực hiện', 'Chờ duyệt', 'Hoàn thành'].map((t, i) => [`col${i}`, '.kanban-col', t, null]),
];

// ------------------------------------------------------------- GIAO VIỆC (Trưởng khoa)
const vu = await login('vunh@huit.edu.vn');
await go(vu, 'thong-ke');
await snap(vu, 'S_before', [['kpiDone', '.kpi', 'Hoàn thành', null]]);

// ------------------------------------------------------------- TẠO VIỆC (from a template)
await go(vu, 'cong-viec/tao');
await snap(vu, 'C0_create', [['btnTpl', 'main button', 'Tạo từ mẫu'], ['titleIn', '#title', null], ['form', 'main form', null]]);
await vu.getByRole('button', { name: /Tạo từ mẫu/ }).click(); await settle(vu, 700);
await snap(vu, 'C1_tpl', [['dlg', 'dialog[open]', null], ['tplItem', '.template-item', 'Ra đề thi cuối kỳ']]);
await vu.locator('.template-item', { hasText: 'Ra đề thi cuối kỳ' }).click(); await settle(vu, 1200);
const createMarks = [['titleIn', '#title', null], ['form', 'main form', null], ['submit', 'main button', 'Tạo công việc'], ['cat', 'main select', null]];
await snap(vu, 'C2_filled', createMarks);
await vu.getByRole('button', { name: 'Tạo công việc', exact: true }).click(); await settle(vu, 900);
await snap(vu, 'C3_created', [['toast', '#toast', null], ['title', 'main h1', 'Ra đề thi'], ['status', 'main .st', null]]);
await settle(vu, 4000);
await go(vu, 'cong-viec?scope=all&view=kanban');
await snap(vu, 'T0_board', kanbanMarks());
await go(vu, 'cong-viec/chi-tiet?id=103');
await snap(vu, 'A0_detail', [['btnAssign', 'main button', '+ Giao việc'], ['title', 'main h1', 'Cập nhật chương trình'], ['kvAssign', 'dl.kv', 'Phân công'], ['tabAssign', 'nav.tabs a', 'Phân công']]);
await vu.getByRole('button', { name: '+ Giao việc' }).click(); await settle(vu, 700);
const assignMarks = [['dlg', 'dialog[open]', null], ['rowBao', 'label.pick-item', 'Phạm Thái Bảo'], ['chkBao', 'label.pick-item input', null], ['roleLead', '.seg label', 'Chủ trì'], ['submit', 'dialog[open] button[type=submit]', 'Giao việc'], ['list', '#person-list', null]];
await snap(vu, 'A1_dialog', assignMarks);
await vu.locator('label.pick-item', { hasText: 'Phạm Thái Bảo' }).click();
await vu.locator('dialog[open] .seg label', { hasText: 'Chủ trì' }).click(); await settle(vu, 300);
await snap(vu, 'A2_filled', assignMarks);
await vu.locator('dialog[open] button[type=submit]').click(); await settle(vu, 450);
await snap(vu, 'A3_done', [['toast', '[data-sonner-toast], .toast, [role=status]', null], ['kvAssign', 'dl.kv', 'Phân công'], ['tabAssign', 'nav.tabs a', 'Phân công']]);
await go(vu, 'cong-viec/chi-tiet?id=103&tab=assign');
await snap(vu, 'A4_assignTab', [['rowBao', 'main .card, main article, main li', 'Phạm Thái Bảo'], ['tabAssign', 'nav.tabs a', 'Phân công']]);

// ------------------------------------------------------------- the new assignee is notified (Phạm Thái Bảo)
const bao = await login('baopt@huit.edu.vn');
await go(bao, 'ca-nhan');
const bellMarks = [['bell', 'details.bell-menu > summary', null], ['badge', '.bell-badge', null], ['noti0', 'a.noti', 'Việc mới'], ['drop', '.bell-dropdown', null]];
await snap(bao, 'B0_home', bellMarks);
await bao.locator('details.bell-menu > summary').click(); await settle(bao, 500);
await snap(bao, 'B1_bell', bellMarks);

// ------------------------------------------------------------- NHẮC HẠN: the deadline pop-up after login (Lê Thị Mai)
const mai = await login('mailt@huit.edu.vn');
await mai.goto(B + '#/ca-nhan'); await settle(mai, 1600);
await snap(mai, 'N0_alert', [['dlg', 'dialog.due-alert', null], ['item', 'a.due-item', null], ['when', '.due-when', null], ['mute', '.due-mute', null]]);
await mai.keyboard.press('Escape'); await settle(mai, 300);

// ------------------------------------------------------------- THEO DÕI (Giảng viên Lê Thị Mai)
await go(mai, 'cong-viec/chi-tiet?id=103&tab=assign');
await snap(mai, 'T1_mine', [['btnAccept', 'main button', 'Tiếp nhận'], ['rowMai', 'main .card, main article', 'Lê Thị Mai'], ['status', 'main .st', 'Chưa bắt đầu']]);
await mai.getByRole('button', { name: 'Tiếp nhận' }).click(); await settle(mai, 450);
await snap(mai, 'T2_accepted', [['btnProgress', 'main button', 'Cập nhật tiến độ'], ['rowMai', 'main .card, main article', 'Lê Thị Mai'], ['status', 'main .st', 'Đang thực hiện'], ['toast', '[data-sonner-toast], .toast, [role=status]', null]]);
await settle(mai, 3500);
await mai.getByRole('button', { name: 'Cập nhật tiến độ' }).first().click(); await settle(mai, 700);
const progMarks = [['dlg', 'dialog[open]', null], ['range', '#percent', null], ['out', '#percent-out', null], ['note', 'dialog[open] textarea', null], ['submit', 'dialog[open] button[type=submit]', null]];
await snap(mai, 'T3_progress', progMarks);
await mai.$eval('#percent', (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '40'); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
await mai.fill('dialog[open] textarea', 'Đã rà soát chuẩn đầu ra, đang soạn đề cương mới');
await settle(mai, 200);
await snap(mai, 'T3b_progressFilled', progMarks);
await mai.locator('dialog[open] button[type=submit]').click(); await settle(mai, 450);
await snap(mai, 'T4_saved', [['rowMai', 'main .card, main article', 'Lê Thị Mai'], ['toast', '[data-sonner-toast], .toast, [role=status]', null], ['status', 'main .st', 'Đang thực hiện']]);
await go(vu, 'cong-viec?scope=all&view=kanban');
await snap(vu, 'T5_board', kanbanMarks());

// ------------------------------------------------------------- GIA HẠN: manager approves an extension request
await go(vu, 'cong-viec/chi-tiet?id=102&tab=assign');
const extMarks = [['btnExt', 'main button', 'Duyệt gia hạn'], ['req', 'main .notice, main [class*=ext], main div', 'Xin gia hạn đến'], ['kvDue', 'dl.kv', 'Hạn hoàn thành'], ['row', 'main article', 'Ngô Dương Hà']];
await snap(vu, 'X0_ext', extMarks);
await vu.getByRole('button', { name: 'Duyệt gia hạn' }).click(); await settle(vu, 700);
await snap(vu, 'X1_dialog', [...extMarks, ['dlg', 'dialog[open]', null], ['compare', '.due-compare', null], ['approve', 'dialog[open] .seg label', 'Đồng ý'], ['submit', 'dialog[open] button[type=submit]', null]]);
await vu.locator('dialog[open] button[type=submit]').click(); await settle(vu, 500);
await snap(vu, 'X2_done', [['toast', '#toast', null], ['kvDue', 'dl.kv', 'Hạn hoàn thành'], ['row', 'main article', 'Ngô Dương Hà']]);
await settle(vu, 4000);

// ------------------------------------------------------------- DUYỆT (Trưởng khoa)
await go(vu, 'cong-viec/chi-tiet?id=104&tab=result');
await snap(vu, 'R0_result', [['btnReview', 'main button', 'Đánh giá'], ['status', 'main .detail-title .st, main .st', 'Chờ duyệt'], ['card', 'main article', 'Ngô Dương Hà'], ['kvProg', 'dl.kv', 'Tiến độ tổng']]);
await vu.getByRole('button', { name: 'Đánh giá', exact: true }).click(); await settle(vu, 700);
const revMarks = [['dlg', 'dialog[open]', null], ['pass', 'dialog[open] .seg label', 'Đạt'], ['comment', 'dialog[open] textarea', null], ['submit', 'dialog[open] button[type=submit]', null]];
await snap(vu, 'R1_dialog', revMarks);
await vu.fill('dialog[open] textarea', 'Kế hoạch đầy đủ, đúng tiến độ.');
await snap(vu, 'R1b_filled', revMarks);
await vu.locator('dialog[open] button[type=submit]').click(); await settle(vu, 450);
await snap(vu, 'R2_done', [['toast', '[data-sonner-toast], .toast, [role=status]', null], ['card', 'main article', 'Ngô Dương Hà'], ['kvProg', 'dl.kv', 'Tiến độ tổng'], ['chipPass', 'main .chips .chip', 'Đạt']]);

// ------------------------------------------------------------- THỐNG KÊ
await settle(vu, 4500);           // let the review toast expire first
await go(vu, 'thong-ke');
await snap(vu, 'S1_stats', [['kpis', '.kpi-grid', null], ['kpiDone', '.kpi', 'Hoàn thành'], ['donut', '.donut-wrap', null], ['bars', '.bars', null], ['export', 'button', 'Xuất Excel'], ['tableUnits', 'section.table-card', 'Theo đơn vị']]);

await browser.close();
