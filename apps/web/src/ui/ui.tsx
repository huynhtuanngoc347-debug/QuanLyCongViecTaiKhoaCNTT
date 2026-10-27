import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { closeDialog } from '../motion';

// ---------------- Biểu tượng (tệp SVG có sẵn trong public/assets) ----------------
const ICON_FILES = {
  brand: '05bd5.svg', grid: 'b51c9.svg', gridActive: '93664.svg', people: '7ef20.svg', peopleActive: '3db2e.svg', shield: '70eaa.svg',
  shieldActive: '97663.svg', chevron: '41598.svg', faculty: '1069b.svg', folder: '78266.svg', folderActive: '7731a.svg', folderLarge: 'adf20.svg',
} as const;
export type IconName = keyof typeof ICON_FILES;
export const Icon = ({ name }: { name: IconName }) => (
  <img className={`icon ${name === 'chevron' ? 'breadcrumb-icon' : ''}`} src={`./assets/${ICON_FILES[name]}`} alt="" aria-hidden="true" />
);

export const Avatar = ({ initials, tone = 0, title }: { initials: string; tone?: number; title?: string }) => (
  <span className={`avatar tone-${Math.abs(tone) % 3}`} title={title} aria-hidden="true">{initials}</span>
);

export const ButtonLink = ({ to, children, kind = '' }: { to: string; children: ReactNode; kind?: string }) => (
  <Link className={`button ${kind}`} to={to}>{children}</Link>
);

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1 tabIndex={-1} id="page-title">{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export const Loading = ({ title = 'Đang tải…' }: { title?: string }) => (
  <div className="card card-pad task-loading" role="status"><span className="spinner" aria-hidden="true" />{title}</div>
);

// ---------------- Ô nhập liệu ----------------
export function Field({ name, label, error, help, children }: { name: string; label: ReactNode; error?: string; help?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {help ? <small id={`${name}-help`}>{help}</small> : null}
      <span className="error-text" id={`${name}-error`} hidden={!error}>{error}</span>
    </div>
  );
}

type InputProps = { name: string; label: ReactNode; error?: string; help?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name'>;
export function Input({ name, label, error, help, ...rest }: InputProps) {
  return (
    <Field name={name} label={label} error={error} help={help}>
      <input id={name} name={name} type="text" aria-describedby={`${name}-error${help ? ` ${name}-help` : ''}`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

type TextareaProps = { name: string; label: ReactNode; error?: string; help?: string } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'name'>;
export function Textarea({ name, label, error, help, ...rest }: TextareaProps) {
  return (
    <Field name={name} label={label} error={error} help={help}>
      <textarea id={name} name={name} aria-describedby={`${name}-error`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export type Option = [string | number, string];
type SelectProps = { name: string; label: ReactNode; options: Option[]; placeholder?: string; error?: string; help?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'name'>;
export function Select({ name, label, options, placeholder, error, help, ...rest }: SelectProps) {
  return (
    <Field name={name} label={label} error={error} help={help}>
      <select id={name} name={name} aria-describedby={`${name}-error${help ? ` ${name}-help` : ''}`} aria-invalid={error ? true : undefined} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </Field>
  );
}

export const Options = ({ items, placeholder }: { items: Option[]; placeholder?: string }) => (
  <>
    {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
    {items.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
  </>
);

/** Nhóm nút chọn một (radio dạng viên thuốc). */
export function Seg({ name, items, value, onChange }: { name: string; items: Option[]; value: string | number; onChange?: (v: string) => void }) {
  const [current, setCurrent] = useState(String(value));
  useEffect(() => setCurrent(String(value)), [value]);
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      {items.map(([v, l]) => (
        <label key={String(v)} className={String(v) === current ? 'on' : ''}>
          <input type="radio" name={name} value={String(v)} checked={String(v) === current} onChange={() => { setCurrent(String(v)); onChange?.(String(v)); }} />
          {l}
        </label>
      ))}
    </div>
  );
}

/** Nhóm liên kết dạng viên thuốc (đổi kiểu xem, kỳ thống kê…). */
export const SegLinks = ({ items, value, label }: { items: [string, string, string][]; value: string; label: string }) => (
  <div className="seg" role="radiogroup" aria-label={label}>
    {items.map(([v, l, href]) => (
      <Link key={v} to={href} className={v === value ? 'on' : ''} aria-current={v === value ? 'page' : undefined}>{l}</Link>
    ))}
  </div>
);

/** Tóm tắt lỗi đầu biểu mẫu; bấm tên trường để chuyển tới ô đó. */
export function ErrorSummary({ errors, message }: { errors: Record<string, string> | null; message?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!errors) return;
    const first = Object.keys(errors)[0];
    const el = first ? (document.getElementById(first) as HTMLElement | null) : null;
    el?.focus();
  }, [errors]);
  if (message) return <div ref={ref} className="form-error error-summary" role="alert">{message}</div>;
  if (!errors || Object.keys(errors).length === 0) return <div className="form-error error-summary" role="alert" hidden />;
  const keys = Object.keys(errors);
  const labelOf = (key: string) => (document.querySelector(`label[for="${key}"]`)?.textContent || '').replace('*', '').trim();
  return (
    <div ref={ref} id="form-error" className="form-error error-summary" role="alert">
      <strong>Chưa lưu được — cần sửa {keys.length} mục:</strong>
      <ul>
        {keys.map((key) => {
          const label = labelOf(key);
          return (
            <li key={key}>
              {document.getElementById(key)
                ? <><button type="button" className="link-button" onClick={() => document.getElementById(key)?.focus()}>{label || key}</button>: </>
                : label ? `${label}: ` : ''}
              {errors[key]}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Hộp thoại dùng thẻ <dialog> (giữ đúng kiểu .task-dialog của giao diện cũ). */
export function Modal({ title, subtitle, wide, onClose, children }: { title: string; subtitle?: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const first = d?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select');
    first?.focus();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} className={`task-dialog ${wide ? 'wide' : ''}`} aria-labelledby="task-dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="dialog-head">
        <div>
          <h2 id="task-dialog-title">{title}</h2>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Đóng">✕</button>
      </div>
      {children}
    </dialog>
  );
}

// ---------------- Thông báo nhanh, hỏi lại, mật khẩu tạm ----------------
interface UiApi {
  toast: (message: string, error?: boolean) => void;
  ask: (message?: string, title?: string, yes?: string) => Promise<boolean>;
  showSecret: (title: string, message: string, secret: string) => void;
}
const UiContext = createContext<UiApi | null>(null);
export const useUi = (): UiApi => {
  const v = useContext(UiContext);
  if (!v) throw new Error('UiProvider missing');
  return v;
};

export function UiProvider({ children }: { children: ReactNode }) {
  const [toastState, setToast] = useState<{ message: string; error: boolean; leaving?: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [askState, setAsk] = useState<{ message: string; title: string; yes: string; resolve: (v: boolean) => void } | null>(null);
  const [secret, setSecret] = useState<{ title: string; message: string; value: string } | null>(null);
  const [copied, setCopied] = useState('Sao chép');
  const askRef = useRef<HTMLDialogElement>(null);
  const secretRef = useRef<HTMLDialogElement>(null);

  const toast = useCallback((message: string, error = false) => {
    window.clearTimeout(timer.current);
    setToast({ message, error });
    // Hết giờ: chạy hiệu ứng trượt ra (200 ms) rồi mới ẩn hẳn.
    timer.current = window.setTimeout(() => {
      setToast((t) => (t ? { ...t, leaving: true } : t));
      timer.current = window.setTimeout(() => setToast(null), 200);
    }, 4500);
  }, []);
  const ask = useCallback((message = 'Những thay đổi chưa lưu sẽ bị bỏ.', title = 'Rời khỏi biểu mẫu?', yes = 'Rời khỏi') =>
    new Promise<boolean>((resolve) => setAsk({ message, title, yes, resolve })), []);
  const showSecret = useCallback((title: string, message: string, value: string) => { setCopied('Sao chép'); setSecret({ title, message, value }); }, []);

  useEffect(() => { if (askState && askRef.current && !askRef.current.open) askRef.current.showModal(); }, [askState]);
  useEffect(() => { if (secret && secretRef.current && !secretRef.current.open) secretRef.current.showModal(); }, [secret]);
  const finishAsk = (v: boolean) => { askState?.resolve(v); closeDialog(askRef.current, () => setAsk(null)); };
  const closeSecret = () => closeDialog(secretRef.current, () => setSecret(null));

  return (
    <UiContext.Provider value={{ toast, ask, showSecret }}>
      {children}
      <div id="toast" key={toastState?.message} className={`toast${toastState?.error ? ' error' : ''}${toastState?.leaving ? ' leaving' : ''}`} role="status" aria-live="polite" hidden={!toastState}>{toastState?.message}</div>
      {askState ? (
        <dialog ref={askRef} id="confirm-dialog" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); finishAsk(false); }}>
          <h2 id="confirm-title">{askState.title}</h2>
          <p id="confirm-message">{askState.message}</p>
          <div className="actions">
            <button type="button" className="button secondary" id="confirm-no" onClick={() => finishAsk(false)}>{askState.yes === 'Rời khỏi' ? 'Tiếp tục chỉnh sửa' : 'Quay lại'}</button>
            <button type="button" className="button" id="confirm-yes" onClick={() => finishAsk(true)}>{askState.yes}</button>
          </div>
        </dialog>
      ) : null}
      {secret ? (
        <dialog ref={secretRef} id="secret-dialog" aria-labelledby="secret-title" onCancel={closeSecret}>
          <h2 id="secret-title">{secret.title}</h2>
          <p id="secret-message">{secret.message}</p>
          {secret.value ? <code id="secret-value" className="secret-value">{secret.value}</code> : null}
          <div className="actions">
            {secret.value ? (
              <button type="button" className="button secondary" id="secret-copy" onClick={async () => {
                try { await navigator.clipboard.writeText(secret.value); setCopied('Đã sao chép'); } catch { setCopied('Hãy chọn và nhấn Ctrl+C'); }
              }}>{copied}</button>
            ) : null}
            <button type="button" className="button" id="secret-close" onClick={closeSecret}>{secret.value ? 'Đã lưu, đóng' : 'Đóng'}</button>
          </div>
        </dialog>
      ) : null}
    </UiContext.Provider>
  );
}

// ---------------- Trạng thái, tiến độ ----------------
export const STATUS: Record<number, [string, string]> = { 0: ['Nháp', 'draft'], 1: ['Chưa bắt đầu', 'new'], 2: ['Đang thực hiện', 'doing'], 3: ['Chờ duyệt', 'review'], 4: ['Hoàn thành', 'done'], 5: ['Tạm dừng', 'paused'], 6: ['Đã hủy', 'cancel'] };
export const A_STATUS: Record<number, [string, string]> = { 0: ['Chờ tiếp nhận', 'new'], 1: ['Đã tiếp nhận', 'doing'], 2: ['Đang thực hiện', 'doing'], 3: ['Chờ duyệt', 'review'], 4: ['Hoàn thành', 'done'], 5: ['Từ chối', 'cancel'], 6: ['Đã hủy', 'cancel'] };
export const PRIORITY: Record<number, [string, string]> = { 1: ['Thấp', 'p1'], 2: ['Bình thường', 'p2'], 3: ['Cao', 'p3'], 4: ['Khẩn cấp', 'p4'] };
export const RESULT: Record<number, [string, string]> = { 0: ['Chờ duyệt', 'review'], 1: ['Đạt', 'done'], 2: ['Cần bổ sung', 'paused'], 3: ['Không đạt', 'cancel'] };
export const ROLE: Record<number, string> = { 1: 'Chủ trì', 2: 'Phối hợp' };
export const RECURRENCE: Record<number, string> = { 0: 'Không lặp', 1: 'Mỗi học kỳ', 2: 'Mỗi năm học' };

export function Badge({ map, value }: { map: Record<number, [string, string]>; value: number }) {
  const [l, c] = map[value] ?? ['—', 'draft'];
  return <span className={`st st-${c}`}><i aria-hidden="true" />{l}</span>;
}
export function Prio({ value }: { value: number }) {
  const [l, c] = PRIORITY[value] ?? PRIORITY[2];
  return <span className={`prio prio-${c}`}>{l}</span>;
}
export function Bar({ value, tone = '' }: { value: number; tone?: string }) {
  const v = Math.round(Number(value) || 0);
  return <span className={`bar ${tone}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}><b style={{ width: `${Math.min(100, v)}%` }} /></span>;
}
export function Avatars({ list }: { list: { id: number; name: string; initials: string }[] }) {
  if (!list.length) return <span className="muted small">Chưa giao</span>;
  return (
    <span className="avatars">
      {list.slice(0, 4).map((a, i) => <Avatar key={`${a.id}-${i}`} initials={a.initials} tone={a.id + i} title={a.name} />)}
      {list.length > 4 ? <span className="avatar more">+{list.length - 4}</span> : null}
    </span>
  );
}

/** Thẻ số liệu (KPI). */
export function Kpi({ label, value, note, tone = '', to }: { label: string; value: ReactNode; note: string; tone?: string; to?: string }) {
  const inner = (
    <>
      <span className="muted small">{label}{to ? <> <span className="kpi-go">›</span></> : null}</span>
      <strong className={tone}>{value}</strong>
      <small className="muted">{note}</small>
    </>
  );
  return to ? <Link className="kpi card" to={to}>{inner}</Link> : <div className="kpi card">{inner}</div>;
}
