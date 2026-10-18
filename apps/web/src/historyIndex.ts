/**
 * Khi người dùng gõ / sửa địa chỉ (#/...) trên thanh địa chỉ, trình duyệt tạo mục lịch sử không có `idx`
 * mà React Router dùng để tính bước lùi/tiến. Thiếu `idx` thì useBlocker không chặn được nút Back
 * ("blocker on a POP navigation to a location that was not created by @remix-run/router")
 * → biểu mẫu đang nhập dở bị bỏ mà không hỏi (BUG-P3-09).
 * Cách sửa: lắng nghe popstate TRƯỚC router, đóng dấu `idx = chỉ số trang trước + 1` cho mục lịch sử đó.
 * Phải gọi installHistoryIndex() trước createHashRouter() và trackHistoryIndex() ngay sau.
 */
let last = 0;

const currentIndex = (): number | null => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
};

export function installHistoryIndex(): void {
  last = currentIndex() ?? 0;
  window.addEventListener('popstate', () => {
    const idx = currentIndex();
    if (idx == null) window.history.replaceState({ ...(window.history.state ?? {}), idx: last + 1 }, '');
    last = currentIndex() ?? last;
  });
}

/** Ghi lại chỉ số sau mỗi lần router điều hướng (push/replace không phát sự kiện popstate). */
export function trackHistoryIndex(router: { subscribe: (fn: () => void) => unknown }): void {
  last = currentIndex() ?? last;
  router.subscribe(() => { last = currentIndex() ?? last; });
}
