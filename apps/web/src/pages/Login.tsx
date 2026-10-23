import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { send } from '../api/client';
import { useSession } from '../session';
import { useUi } from '../ui/ui';

const REMEMBER_KEY = 'khoa-cntt:email';
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } };
const remember = (email: string, on: boolean) => { try { if (on) localStorage.setItem(REMEMBER_KEY, email); else localStorage.removeItem(REMEMBER_KEY); } catch { /* bỏ qua */ } };

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
  const [forgot, setForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  useEffect(() => {
    if (forgot) return;
    document.title = 'Đăng nhập · Khoa Công nghệ Thông tin';
    (saved ? pwRef.current : emailRef.current)?.focus();
  }, [saved, forgot]);

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

  return (
    <div className="login-cover">
      <img className="login-photo" src="/login-thu-vien-huit.jpg" alt="" aria-hidden="true" width="1024" height="768" fetchPriority="high" />
      <main className="login-cover-main">
        <section className="login-panel login-float">
          <header className="login-float-head">
            <img className="login-seal" src="/logo-huit.webp" alt="Logo Trường Đại học Công Thương Thành phố Hồ Chí Minh" width="72" height="72" />
            {/* Khoảng trắng không ngắt giữ "Công nghệ" và "Thông tin" liền nhau khi tên phải xuống dòng. */}
            <p className="login-float-title">Khoa Công{' '}nghệ Thông{' '}tin</p>
            <p className="login-float-school">Trường Đại học Công Thương Thành phố Hồ Chí Minh</p>
          </header>
          {forgot ? <ForgotPassword initialEmail={forgotEmail} onDone={(message) => { setForgot(false); toast(message); }} onCancel={() => setForgot(false)} /> : <>
          <h1 id="page-title" tabIndex={-1}>Đăng nhập</h1>
          <p className="login-sub">Hệ thống quản lý công việc. Dùng email công tác và mật khẩu được cấp.</p>
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
                <button type="button" className="link-button small" onClick={() => { setForgotEmail(emailRef.current?.value.trim() ?? ''); setForgot(true); }}>Quên mật khẩu?</button>
              </div>
              <button className="button login-submit" type="submit" disabled={busy}>Đăng nhập</button>
            </div>
          </form>
          </>}
        </section>
        <p className="login-cover-foot">© {new Date().getFullYear()} Khoa Công nghệ Thông tin · <a href="https://commons.wikimedia.org/wiki/File:Th%C6%B0_vi%E1%BB%87n_HUIT.jpg" target="_blank" rel="noopener noreferrer">Ảnh: “Thư viện HUIT”, Nguoisinhvien, CC BY-SA 4.0</a></p>
      </main>
    </div>
  );
}

/** Quên mật khẩu: bước 1 gửi mã 6 chữ số về email, bước 2 nhập mã + mật khẩu mới. */
function ForgotPassword({ initialEmail, onDone, onCancel }: { initialEmail: string; onDone: (message: string) => void; onCancel: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [info, setInfo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [show, setShow] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { document.title = 'Quên mật khẩu · Khoa Công nghệ Thông tin'; headingRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function requestCode() {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setErrors({ email: 'Email chưa đúng định dạng, ví dụ ten@huit.edu.vn.' }); return; }
    setBusy(true); setFormError(''); setErrors({});
    try {
      const r = await send<{ message: string }>('POST', '/api/auth/quen-mat-khau', { email: value });
      if (r.errors) { setErrors(r.errors); return; }
      setInfo(r.value.message);
      setStep('code');
      setWait(60);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get('code') || '').trim(), newPassword = String(fd.get('newPassword') || ''), confirm = String(fd.get('confirm') || '');
    const local: Record<string, string> = {};
    if (!/^\d{6}$/.test(code)) local.code = 'Mã xác thực gồm 6 chữ số trong email.';
    if (!newPassword) local.newPassword = 'Nhập mật khẩu mới.';
    else if (confirm !== newPassword) local.confirm = 'Mật khẩu nhập lại chưa khớp.';
    setErrors(local); setFormError('');
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const r = await send('POST', '/api/auth/dat-lai-mat-khau', { email: email.trim(), code, newPassword });
      if (r.errors) { setErrors(r.errors); return; }
      onDone('Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const err = (name: string) => <span className="error-text" id={`${name}-error`} hidden={!errors[name]}>{errors[name]}</span>;
  return (
    <>
      <h1 id="page-title" tabIndex={-1} ref={headingRef}>Quên mật khẩu</h1>
      <p className="login-sub">{step === 'email' ? 'Nhập email công tác. Hệ thống gửi mã xác thực 6 chữ số về hộp thư để bạn đặt mật khẩu mới.' : info}</p>
      <div className="form-error" role="alert" hidden={!formError}>{formError}</div>
      {step === 'email' ? (
        <form key="email" noValidate onSubmit={(e) => { e.preventDefault(); void requestCode(); }}>
          <div className="form-body">
            <div className="field">
              <label htmlFor="forgot-email">Email công tác</label>
              <input id="forgot-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors({}); }} autoComplete="username" required maxLength={254} placeholder="ten@huit.edu.vn" aria-describedby="email-error" aria-invalid={errors.email ? true : undefined} />
              {err('email')}
            </div>
            <button className="button login-submit" type="submit" disabled={busy}>Gửi mã xác thực</button>
            <button type="button" className="link-button" onClick={onCancel}>Quay lại đăng nhập</button>
          </div>
        </form>
      ) : (
        <form key="code" noValidate onSubmit={reset}>
          <div className="form-body">
            <div className="field">
              <label htmlFor="code">Mã xác thực</label>
              <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 chữ số" aria-describedby="code-error" aria-invalid={errors.code ? true : undefined} />
              {err('code')}
            </div>
            <div className="field">
              <label htmlFor="newPassword">Mật khẩu mới</label>
              <div className="password-box">
                <input id="newPassword" name="newPassword" type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={128} aria-describedby="newPassword-hint newPassword-error" aria-invalid={errors.newPassword ? true : undefined} />
                <button type="button" className="password-toggle" aria-controls="newPassword" aria-pressed={show} aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShow(!show)}>{show ? 'Ẩn' : 'Hiện'}</button>
              </div>
              <small id="newPassword-hint" className="muted small">Từ 8 ký tự, có cả chữ và số.</small>
              {err('newPassword')}
            </div>
            <div className="field">
              <label htmlFor="confirm">Nhập lại mật khẩu mới</label>
              <input id="confirm" name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={128} aria-describedby="confirm-error" aria-invalid={errors.confirm ? true : undefined} />
              {err('confirm')}
            </div>
            <button className="button login-submit" type="submit" disabled={busy}>Đặt lại mật khẩu</button>
            <div className="login-row">
              <button type="button" className="link-button small" disabled={busy || wait > 0} onClick={() => void requestCode()}>{wait > 0 ? `Gửi lại mã sau ${wait} giây` : 'Gửi lại mã'}</button>
              <button type="button" className="link-button small" onClick={onCancel}>Quay lại đăng nhập</button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}

export function StatusPage({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  useEffect(() => { document.title = `${title} · Khoa Công nghệ Thông tin`; }, [title]);
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
