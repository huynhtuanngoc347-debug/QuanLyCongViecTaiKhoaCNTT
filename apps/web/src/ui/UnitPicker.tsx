import { useEffect, useMemo, useRef, useState } from 'react';
import type { UnitDto } from '@khoa/shared';
import { normalize } from '../format';
import { Glyph, type GlyphName } from './glyph';

/**
 * Chọn đơn vị dạng cây (thay <select> thụt lề bằng "└").
 * Giá trị gửi qua <input type="hidden" name={name}>; các lựa chọn đặc biệt (đơn vị gốc, tạo đơn vị cha mới) đứng riêng ở đầu.
 */
export interface PickerSpecial { value: string; label: string; hint: string; icon: GlyphName }
interface Row { unit: UnitDto; depth: number; parentName: string; last: boolean[] }

export function UnitPicker({ name, label, units, value, onChange, specials, placeholder = 'Chọn đơn vị', error }: {
  name: string; label: string; units: UnitDto[]; value: string; onChange: (v: string) => void;
  specials: PickerSpecial[]; placeholder?: string; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const active = units.filter((u) => u.active);
    const byParent = (pid: number | null) => active.filter((u) => (u.parentId ?? null) === pid).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    (function walk(pid: number | null, depth: number, last: boolean[], parentName: string) {
      const kids = byParent(pid);
      kids.forEach((u, i) => {
        const isLast = i === kids.length - 1;
        out.push({ unit: u, depth, parentName, last: [...last, isLast] });
        walk(u.id, depth + 1, [...last, isLast], u.name);
      });
    })(null, 0, [], '');
    // Đơn vị đang hoạt động nhưng cha đã ngừng: vẫn cho chọn, đặt ở cuối như gốc.
    active.filter((u) => !out.some((r) => r.unit.id === u.id)).forEach((u) => out.push({ unit: u, depth: 0, parentName: '', last: [true] }));
    return out;
  }, [units]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const q = normalize(query);
  const shown = q ? rows.filter((r) => normalize(`${r.unit.name} ${r.unit.type} ${r.parentName}`).includes(q)) : rows;
  const special = specials.find((s) => s.value === value);
  const unit = rows.find((r) => String(r.unit.id) === value);
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <div className="field unit-picker" ref={box}>
      <label htmlFor={name}>{label}</label>
      <input type="hidden" name={name} value={value} />
      <button type="button" id={name} className={`picker-trigger ${open ? 'open' : ''} ${value ? '' : 'empty'}`} aria-haspopup="listbox" aria-expanded={open}
        aria-invalid={error ? true : undefined} aria-describedby={`${name}-error`} onClick={() => setOpen((o) => !o)}>
        {special ? <><span className="picker-ico"><Glyph name={special.icon} size={16} /></span><span className="picker-value"><strong>{special.label}</strong></span></>
          : unit ? <><span className="picker-ico"><Glyph name="sitemap" size={16} /></span><span className="picker-value"><strong>{unit.unit.name}</strong>{unit.parentName ? <small>thuộc {unit.parentName}</small> : null}</span><span className="unit-chip">{unit.unit.type}</span></>
            : <span className="picker-value placeholder">{placeholder}</span>}
        <Glyph name="sort" size={16} className="picker-caret" />
      </button>
      {open ? (
        <div className="picker-pop" role="listbox" aria-label={label}>
          <label className="picker-search"><Glyph name="search" size={15} /><input ref={search} type="search" placeholder="Tìm tên hoặc loại đơn vị…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm đơn vị" /></label>
          {!q && specials.length ? (
            <div className="picker-specials">
              {specials.map((s) => (
                <button key={s.value} type="button" role="option" aria-selected={value === s.value} className={`picker-special ${value === s.value ? 'on' : ''}`} onClick={() => pick(s.value)}>
                  <span className="picker-ico"><Glyph name={s.icon} size={16} /></span><span><strong>{s.label}</strong><small>{s.hint}</small></span>
                  {value === s.value ? <Glyph name="check" size={16} className="picker-check" /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="picker-list">
            {!q ? <div className="picker-group">Đơn vị hiện có</div> : null}
            {shown.map((r) => {
              const on = String(r.unit.id) === value;
              return (
                <button key={r.unit.id} type="button" role="option" aria-selected={on} className={`picker-row ${on ? 'on' : ''} ${r.depth === 0 && !q ? 'root' : ''}`} onClick={() => pick(String(r.unit.id))}>
                  {!q ? r.last.slice(1).map((isLast, i) => <span key={i} className={`tree-guide ${i === r.last.length - 2 ? (isLast ? 'elbow' : 'tee') : r.last[i + 1] ? '' : 'pipe'}`} aria-hidden="true" />) : null}
                  <span className="picker-name"><strong>{r.unit.name}</strong>{q && r.parentName ? <small>thuộc {r.parentName}</small> : null}</span>
                  <span className="unit-chip">{r.unit.type}</span>
                  {on ? <Glyph name="check" size={16} className="picker-check" /> : null}
                </button>
              );
            })}
            {!shown.length ? <p className="picker-empty">Không có đơn vị phù hợp.</p> : null}
          </div>
        </div>
      ) : null}
      <span className="error-text" id={`${name}-error`} hidden={!error}>{error}</span>
    </div>
  );
}
