import { useEffect, useRef, useState } from 'react';
import type { PersonDto } from '@khoa/shared';
import { normalize } from '../format';
import { Avatar } from './ui';
import { Glyph } from './glyph';

/**
 * Chọn người dùng có tìm kiếm (thay <select> "Tên — email" dài). Giá trị gửi qua <input type="hidden" name={name}>.
 * subtitle(p): dòng phụ, ví dụ đơn vị chính.
 */
export function PersonPicker({ name, label, people, value, onChange, subtitle, placeholder = 'Chọn người dùng', error }: {
  name: string; label: string; people: PersonDto[]; value: string; onChange: (v: string) => void;
  subtitle?: (p: PersonDto) => string; placeholder?: string; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const sorted = [...people].sort((a, b) => a.name.split(' ').slice(-1)[0].localeCompare(b.name.split(' ').slice(-1)[0], 'vi') || a.name.localeCompare(b.name, 'vi'));
  const q = normalize(query);
  const shown = q ? sorted.filter((p) => normalize(`${p.name} ${p.email} ${subtitle?.(p) ?? ''}`).includes(q)) : sorted;
  const current = people.find((p) => String(p.id) === value);
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };
  return (
    <div className="field unit-picker" ref={box}>
      <label htmlFor={name}>{label}</label>
      <input type="hidden" name={name} value={value} />
      <button type="button" id={name} className={`picker-trigger ${open ? 'open' : ''} ${current ? '' : 'empty'}`} aria-haspopup="listbox" aria-expanded={open}
        aria-invalid={error ? true : undefined} aria-describedby={`${name}-error`} onClick={() => setOpen((o) => !o)}>
        {current ? <><Avatar initials={current.initials} tone={current.id} /><span className="picker-value"><strong>{current.name}</strong><small>{current.email}</small></span></>
          : <span className="picker-value placeholder">{placeholder}</span>}
        <Glyph name="sort" size={16} className="picker-caret" />
      </button>
      {open ? (
        <div className="picker-pop" role="listbox" aria-label={label}>
          <label className="picker-search"><Glyph name="search" size={15} /><input ref={search} type="search" placeholder="Tìm tên, email hoặc đơn vị…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm người dùng" /></label>
          <div className="picker-list">
            <div className="picker-group">{shown.length} người dùng</div>
            {shown.map((p) => {
              const on = String(p.id) === value, sub = subtitle?.(p);
              return (
                <button key={p.id} type="button" role="option" aria-selected={on} className={`picker-row person-row ${on ? 'on' : ''}`} onClick={() => pick(String(p.id))}>
                  <Avatar initials={p.initials} tone={p.id} />
                  <span className="picker-name"><strong>{p.name}</strong><small>{p.email}{sub ? `, ${sub}` : ''}</small></span>
                  {on ? <Glyph name="check" size={16} className="picker-check" /> : null}
                </button>
              );
            })}
            {!shown.length ? <p className="picker-empty">Không có người dùng phù hợp.</p> : null}
          </div>
        </div>
      ) : null}
      <span className="error-text" id={`${name}-error`} hidden={!error}>{error}</span>
    </div>
  );
}
