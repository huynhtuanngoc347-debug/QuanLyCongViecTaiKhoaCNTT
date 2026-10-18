import { useEffect, useId, useRef, useState } from 'react';
import { normalize } from '../format';
import { Glyph } from './glyph';

/** Một gợi ý: giá trị lưu + mô tả (không bắt buộc), ví dụ ['PGS', 'Phó Giáo sư']. */
export type ComboOption = [value: string, hint: string];

/**
 * Ô nhập có danh sách gợi ý thả xuống (combobox theo mẫu ARIA 1.2), thay cho <datalist> của trình duyệt.
 * - Gõ để lọc; ↑ ↓ chọn, Enter điền, Esc đóng; vẫn nhập tự do giá trị không có trong danh sách.
 * - Ô nhập không bị điều khiển (giữ `name` + defaultValue) để biểu mẫu đọc bằng FormData như các ô khác;
 *   khi chọn gợi ý thì phát sự kiện `input` để biểu mẫu cập nhật bản xem trước và cờ "chưa lưu".
 */
export function Combobox({ name, defaultValue = '', options, placeholder, invalid, maxLength, label }: {
  name: string; defaultValue?: string; options: ComboOption[]; placeholder?: string; invalid?: boolean; maxLength?: number; label: string;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false); // chỉ lọc khi người dùng đang gõ, mở bằng nút ▾ thì hiện đủ
  const [active, setActive] = useState(-1);

  const q = normalize(text);
  const shown = filter && q ? options.filter(([v, h]) => normalize(`${v} ${h}`).includes(q)) : options;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (value: string) => {
    const el = input.current; if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setOpen(false); setActive(-1); el.focus();
  };
  const show = (all: boolean) => {
    setFilter(!all); setOpen(true);
    const i = options.findIndex(([v]) => v === text.trim());
    setActive(all ? i : -1);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { show(true); return; }
      if (!shown.length) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % shown.length : (i <= 0 ? shown.length - 1 : i - 1)));
    } else if (e.key === 'Enter' && open && active >= 0 && shown[active]) {
      e.preventDefault(); pick(shown[active][0]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); setOpen(false);
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`combo ${open ? 'open' : ''}`} ref={box}>
      <input ref={input} id={name} name={name} type="text" defaultValue={defaultValue} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined}
        aria-describedby={`${name}-error`} aria-invalid={invalid || undefined}
        onInput={(e) => { setText(e.currentTarget.value); setFilter(true); setOpen(true); setActive(-1); }}
        onKeyDown={onKey} onClick={() => { if (!open) show(true); }} />
      <button type="button" className="combo-toggle" tabIndex={-1} aria-label={open ? `Đóng gợi ý ${label}` : `Mở gợi ý ${label}`}
        onMouseDown={(e) => e.preventDefault()} onClick={() => { if (open) setOpen(false); else { show(true); input.current?.focus(); } }}>
        <Glyph name="chevronDown" size={16} />
      </button>
      {open ? (
        <ul className="combo-pop" role="listbox" id={listId} aria-label={label}>
          {shown.length ? shown.map(([v, h], i) => {
            const selected = v === text.trim();
            return (
              <li key={v} id={`${listId}-${i}`} role="option" aria-selected={selected}
                className={`combo-opt ${i === active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(v)}>
                <span className="combo-text"><strong>{v}</strong>{h && h !== v ? <small>{h}</small> : null}</span>
                {selected ? <Glyph name="tick" size={16} className="combo-check" /> : null}
              </li>
            );
          }) : <li className="combo-empty" role="presentation">Không có gợi ý khớp. Giữ nguyên “{text.trim()}”.</li>}
        </ul>
      ) : null}
    </div>
  );
}
