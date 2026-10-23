import { useState } from 'react';
import { useIsMobile } from './useIsMobile';

/** Điện thoại: danh sách dài chỉ hiện phần đầu, bấm "Hiện thêm" để xem tiếp. Máy tính hiện đủ như cũ. */
export function useShowMore(step: number) {
  const mobile = useIsMobile();
  const [n, setN] = useState(step);
  return {
    take: <T,>(xs: T[]): T[] => (mobile ? xs.slice(0, n) : xs),
    more: (total: number) => (mobile && total > n
      ? <button type="button" className="button secondary show-more" onClick={() => setN(n + step * 2)}>Hiện thêm ({total - n} còn lại)</button>
      : null),
  };
}
