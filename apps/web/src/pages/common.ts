import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useUi } from '../ui/ui';

/** Đặt tiêu đề tab trình duyệt. */
export function useTitle(title: string): void {
  useEffect(() => { document.title = `${title} · Khoa CNTT`; }, [title]);
}

/**
 * Biểu mẫu có thay đổi chưa lưu: hỏi lại trước khi rời trang (trong ứng dụng và khi đóng tab).
 * Trả hàm đánh dấu đã sửa / đã lưu.
 */
export function useDirtyGuard(): { dirty: boolean; markDirty: () => void; markClean: () => void } {
  const [dirty, setDirty] = useState(false);
  const ref = useRef(false);
  const { ask } = useUi();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => ref.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void ask().then((yes) => (yes ? blocker.proceed() : blocker.reset()));
  }, [blocker, ask]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return {
    dirty,
    markDirty: () => { if (!ref.current) { ref.current = true; setDirty(true); } },
    markClean: () => { ref.current = false; setDirty(false); },
  };
}

export const formValues = (form: HTMLFormElement): Record<string, string> =>
  Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]));
