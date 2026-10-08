import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Icon, useUi } from '../ui/ui';

const REMEMBER_KEY = 'khoa-cntt:email';
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } };
const remember = (email: string, on: boolean) => { try { if (on) localStorage.setItem(REMEMBER_KEY, email); else localStorage.removeItem(REMEMBER_KEY); } catch { /* bỏ qua */ } };

const FEATURES: [string, string][] = [
  ['Giao việc rõ ràng', 'Giao cho từng người hoặc cả bộ môn, theo dõi tiến độ theo thời gian thực.'],
  ['Không bỏ sót hạn', 'Nhắc việc sắp đến hạn và quá hạn ngay khi đăng nhập.'],
  ['Thống kê minh bạch', 'Số liệu theo đơn vị, theo học kỳ và của riêng bạn.'],
];

export function LoginPage() {
  const s = useSession();
  const navigate = useNavigate();
  const { toast } = useUi();
  const saved = remembered();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = 'Đăng nhập · Khoa CNTT'; (saved ? pwRef.current : emailRef.current)?.focus(); }, [saved]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || '');
    const local: Record<string, string> = {};
    if (!email) local.email = 'Nhập email công tác.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) local.email = 'Email chưa đúng định dạng, ví dụ ten@huit.edu.vn.';
    if (!password) local.password = 'Nhập mật khẩu.';
    setFormError('');
    setErrors(local);
    if (Object.keys(local).length) { (local.email ? emailRef : pwRef).current?.focus(); return; }
    setBusy(true);
    try {
      const result = await s.login(email, password);
      if (result.errors) { setErrors(result.errors); return; }
      remember(email, fd.get('remember') === '1');
      const first = result.value.portals[0];
      navigate('/' + (first?.key ?? 'ca-nhan'), { replace: true });
      toast(`Xin chào ${result.value.user.name}. Bạn đang ở ${first?.title ?? 'trang chính'}.`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const brand = (cls: string) => (
    <div className={`brand login-brand ${cls}`}><span className="brand-mark"><Icon name="brand" /></span><span><span className="brand-name">Khoa CNTT</span><small>Quản lý công việc</small></span></div>
  );
  return (
    <div className="login-shell">
      <div className="login-frame">
        <aside className="login-hero" aria-hidden="true">
          {brand('')}
          <div className="login-hero-text">
            <p className="login-kicker">Khoa Công nghệ Thông tin</p>
            <h2>Mọi công việc của khoa, ở cùng một nơi.</h2>
            <ul className="login-features">{FEATURES.map(([t, d]) => <li key={t}><i /><span><strong>{t}</strong><small>{d}</small></span></li>)}</ul>
          </div>
          <p className="login-foot">© {new Date().getFullYear()} Khoa Công nghệ Thông tin</p>
        </aside>
        <section className="login-panel">
          {brand('login-brand-mobile')}
          <h1 id="page-title" tabIndex={-1}>Đăng nhập</h1>
          <p className="muted login-sub">Dùng email công tác và mật khẩu được cấp.</p>
          <form id="login-form" noValidate onSubmit={submit}>
            <div id="form-error" className="form-error" role="alert" hidden={!formError}>{formError}</div>
            <div className="form-body">
              <div className="field">
                <label htmlFor="email">Email công tác</label>
                <input ref={emailRef} id="email" name="email" type="email" defaultValue={saved} autoComplete="username" required maxLength={254} placeholder="ten@huit.edu.vn" aria-describedby="email-error" aria-invalid={errors.email ? true : undefined} onInput={() => errors.email && setErrors({ ...errors, email: '' })} />
                <span className="error-text" id="email-error" hidden={!errors.email}>{errors.email}</span>
              </div>
              <div className="field">
                <label htmlFor="password">Mật khẩu</label>
                <div className="password-box">
                  <input ref={pwRef} id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required maxLength={256} aria-describedby="password-error caps-hint" aria-invalid={errors.password ? true : undefined}
                    onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))} onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))} onInput={() => errors.password && setErrors({ ...errors, password: '' })} />
                  <button type="button" className="password-toggle" aria-controls="password" aria-pressed={show} aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => { setShow(!show); pwRef.current?.focus(); }}>{show ? 'Ẩn' : 'Hiện'}</button>
                </div>
                <small id="caps-hint" className="caps-hint" hidden={!caps}>Caps Lock đang bật</small>
                <span className="error-text" id="password-error" hidden={!errors.password}>{errors.password}</span>
              </div>
              <div className="login-row">
                <label className="check"><input type="checkbox" name="remember" value="1" defaultChecked={!!saved} /> Ghi nhớ email</label>
                <span className="muted small">Quên mật khẩu? Liên hệ quản trị viên khoa.</span>
              </div>
              <button className="button login-submit" type="submit" disabled={busy}>Đăng nhập</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

export function StatusPage({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  useEffect(() => { document.title = `${title} · Khoa CNTT`; }, [title]);
  return (
    <div className="login-shell">
      <section className="card card-pad login-card stack">
        <h1 id="page-title" tabIndex={-1}>{title}</h1>
        <p>{message}</p>
        {action}
      </section>
    </div>
  );
}
