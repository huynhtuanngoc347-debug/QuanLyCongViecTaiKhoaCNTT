/**
 * Chuyển động dựa trên DOM, dùng chung cho mọi trang (gọi initMotion() một lần ở main.tsx):
 *  1. Khối nội dung xuất hiện so le khi cuộn tới (IntersectionObserver) — chỉ các khối quan trọng, không phải mọi phần tử.
 *  2. Số liệu (ô thống kê, KPI) đếm lên khi lần đầu hiện ra.
 *  3. Thanh trên cùng đổ bóng khi trang đã cuộn.
 * Không bao giờ chặn nội dung: nếu trình duyệt thiếu IntersectionObserver, hoặc người dùng chọn giảm chuyển động, mọi thứ hiện ngay.
 */

/** Khối được "trồi lên" khi vào màn hình. Thứ tự quan trọng: khối cha đứng trước để khối con bên trong bỏ qua. */
const REVEAL = [
  '.portal-header', '.admin-header', '.page-header', '.detail-head', '.stats-head', '.view-switch',
  '.dash-head', '.stat-tile', '.kpi', '.module', '.kv', '.me-card', '.mp-card', '.mp-stats',
  '.card', '.kanban-col', '.m-group', '.noti-days > section', '.task-row',
].join(',');
/** Vùng không áp dụng: hộp thoại, menu thả xuống, khung điều hướng, trang đăng nhập. */
const SKIP = 'dialog, .bell-dropdown, .user-dropdown, .sidebar, .topbar, .m-tabbar, .login-frame, .login-card, .picker-pop, .combo-pop';
/** Số liệu được đếm lên (chỉ khi nội dung là một số nguyên, có thể kèm "%"). */
const COUNTERS = '.stat-body b, .kpi strong, .me-tile b, .mp-stats b, .mp-rate-big b';

const STAGGER = 60, MAX_STAGGER = 6;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateCount(el: HTMLElement) {
  const node = el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE ? (el.firstChild as Text) : null;
  if (!node) return;
  const m = /^(\d{1,6})(%?)$/.exec(node.nodeValue?.trim() ?? '');
  if (!m) return;
  const target = Number(m[1]), suffix = m[2];
  if (target < 2) return;
  const start = performance.now(), dur = Math.min(900, 400 + target * 12);
  let last = '';
  const step = (now: number) => {
    // React đã ghi giá trị mới vào ô này (dữ liệu tải lại) → dừng, không ghi đè.
    if (last && node.nodeValue !== last) return;
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    last = `${Math.round(target * eased)}${suffix}`;
    node.nodeValue = last;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initMotion(root: HTMLElement = document.body): void {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;

  // ---- 3. Thanh trên cùng ----
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 4);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---- 1 + 2. Xuất hiện khi cuộn tới + đếm số ----
  const seen = new WeakSet<Element>();
  const counted = new WeakSet<Element>();
  const io = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    visible.forEach((el, i) => {
      io.unobserve(el);
      el.style.setProperty('--rv-delay', `${Math.min(i, MAX_STAGGER) * STAGGER}ms`);
      el.classList.add('rv-in');
      el.addEventListener('transitionend', () => { el.classList.add('rv-done'); el.style.removeProperty('--rv-delay'); }, { once: true });
      el.querySelectorAll<HTMLElement>(COUNTERS).forEach((c) => { if (!counted.has(c)) { counted.add(c); animateCount(c); } });
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });

  const scan = () => {
    if (reduced()) return;
    root.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
      if (seen.has(el)) return;
      // Phần tử đang ẩn (display:none, ví dụ danh sách chỉ dành cho điện thoại) không bao giờ "vào màn hình":
      // bỏ qua để nó luôn hiện bình thường khi được hiển thị sau này (đổi cỡ cửa sổ).
      if (!el.getClientRects().length) return;
      seen.add(el);
      if (el.closest(SKIP) || el.parentElement?.closest('.rv')) return; // không lồng hiệu ứng trong khối đã có hiệu ứng
      el.classList.add('rv');
      io.observe(el);
      // Chốt an toàn: khối đang nằm trong màn hình mà sau 1,2 s chưa hiện (trình duyệt tạm dừng vẽ, observer trễ…)
      // thì hiện ngay, không bao giờ để nội dung bị ẩn.
      window.setTimeout(() => {
        if (el.classList.contains('rv-in') || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) { io.unobserve(el); el.classList.add('rv-in', 'rv-done'); }
      }, 1200);
    });
  };

  // Quét lại khi React gắn nội dung mới (đổi trang, dữ liệu tải xong). Gộp nhiều thay đổi trong một khung hình.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; scan(); });
  }).observe(root, { childList: true, subtree: true });
  scan();
}

/** Đóng <dialog> có hiệu ứng lùi xuống (dùng cho hộp hỏi lại / mật khẩu tạm). */
export function closeDialog(d: HTMLDialogElement | null, after?: () => void): void {
  if (!d?.open) { after?.(); return; }
  if (reduced()) { d.close(); after?.(); return; }
  d.classList.add('closing');
  window.setTimeout(() => { d.classList.remove('closing'); d.close(); after?.(); }, 150);
}
