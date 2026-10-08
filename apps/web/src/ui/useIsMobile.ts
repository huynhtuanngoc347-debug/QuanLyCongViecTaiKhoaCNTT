import { useEffect, useState } from 'react';

/** Màn hình điện thoại (≤ 720px, khớp mobile.css), cập nhật khi xoay máy / đổi cỡ cửa sổ. */
const MOBILE_QUERY = '(max-width: 720px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
