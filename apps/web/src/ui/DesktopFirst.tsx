import { useEffect, useRef, useState } from 'react';
import { closeDialog } from '../motion';
import { Glyph } from './glyph';
import { useIsMobile } from './useIsMobile';

/**
 * Thao tác nhập liệu phức tạp (tạo, sửa, giao việc…) trên điện thoại: nhắc nên làm trên máy tính nhưng vẫn cho tiếp tục.
 * Không chặn quyền hay nghiệp vụ — chỉ là lời khuyên giao diện. Trên máy tính chạy thẳng.
 */
export function useDesktopFirst() {
  const mobile = useIsMobile();
  const [req, setReq] = useState<{ label: string; run: () => void } | null>(null);
  const guard = (label: string, run: () => void) => (mobile ? setReq({ label, run }) : run());
  const node = req ? <DesktopFirstDialog label={req.label} onClose={(go) => { const r = req.run; setReq(null); if (go) r(); }} /> : null;
  return { guard, node, mobile };
}

function DesktopFirstDialog({ label, onClose }: { label: string; onClose: (go: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const close = (go: boolean) => closeDialog(ref.current, () => onClose(go));
  return (
    <dialog ref={ref} className="action-sheet desktop-first" aria-labelledby="df-title" aria-describedby="df-text"
      onCancel={(e) => { e.preventDefault(); close(false); }} onClick={(e) => { if (e.target === ref.current) close(false); }}>
      <span className="df-ico" aria-hidden="true"><Glyph name="monitor" size={26} /></span>
      <h2 id="df-title">{label} nên làm trên máy tính</h2>
      <p id="df-text">Biểu mẫu này có nhiều trường và danh sách chọn, thao tác chính xác hơn trên màn hình lớn. Nếu cần gấp, bạn vẫn có thể tiếp tục trên điện thoại.</p>
      <div className="df-actions">
        <button type="button" className="button" onClick={() => close(false)} autoFocus>Để sau</button>
        <button type="button" className="button secondary" onClick={() => close(true)}>Vẫn tiếp tục</button>
      </div>
    </dialog>
  );
}
