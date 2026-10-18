import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { DueAlertDto, NotificationDto } from '@khoa/shared';
import { api, get } from '../api/client';
import { useSession } from '../session';
import { DESKTOP_ONLY, PORTAL_ICONS, TASK_LABELS, useAccess, type MenuItem } from '../nav';
import { Icon, Loading, useUi } from '../ui/ui';
import { Glyph } from '../ui/glyph';
import { useIsMobile } from '../ui/useIsMobile';
import { closeDialog } from '../motion';
import { useNotifications, useTaskList } from '../tasks/queries';
import { DAY, fmtShort, pct, relative, todayIso, toDate } from '../format';

// ---------------- Chuông thông báo ----------------
const P = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 15l2 2 4-4" /></>,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};
const Svg = ({ children, size = 18 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const NOTI_ICON: Record<string, [React.ReactNode, string]> = {
  QuaHan: [P.clock, 'danger'], SapDenHan: [P.clock, 'warn'], GiaHan: [P.cal, 'warn'], KetQua: [P.doc, 'info'], GiaoViec: [P.pin, 'info'],
  TiepNhan: [P.users, 'purple'], BinhLuan: [P.chat, 'green'], ChamTienDo: [P.bell, 'warn'], LapLai: [P.repeat, 'info'], HeThong: [P.info, 'muted'],
};

export function NotiItem({ n, compact = true, onOpen }: { n: NotificationDto; compact?: boolean; onOpen?: () => void }) {
  const qc = useQueryClient();
  const [ic, tone] = NOTI_ICON[n.type] ?? NOTI_ICON.HeThong;
  return (
    <Link className={`noti ${n.read ? '' : 'unread'}`} to={n.taskId ? `/cong-viec/chi-tiet?id=${n.taskId}` : '/thong-bao'}
      onClick={() => {
        if (!n.read) api('POST', `/api/thong-bao/${n.id}/da-doc`).then(() => { void qc.invalidateQueries({ queryKey: ['notif'] }); void qc.invalidateQueries({ queryKey: ['notif-all'] }); }).catch(() => {});
        onOpen?.();
      }}>
      <span className={`noti-ico ${tone}`}><Svg>{ic}</Svg></span>
      <span className="noti-text">
        <strong>{n.title}</strong>
        {compact ? <small>{n.content}</small> : <span>{n.content}</span>}
        <small className="muted">{relative(n.createdAt)}{n.needsAction ? <> · <b className="warn-text">cần xử lý</b></> : null}</small>
      </span>
      {n.read ? null : <i className="unread-dot" aria-label="Chưa đọc" />}
    </Link>
  );
}

export function useReadAll() {
  const qc = useQueryClient();
  const { toast } = useUi();
  return async () => {
    try {
      await api('POST', '/api/thong-bao/da-doc-tat-ca');
      void qc.invalidateQueries({ queryKey: ['notif'] });
      void qc.invalidateQueries({ queryKey: ['notif-all'] });
    } catch (e) { toast((e as Error).message, true); }
  };
}

function Bell() {
  const q = useNotifications();
  const ref = useRef<HTMLDetailsElement>(null);
  const readAll = useReadAll();
  const n = q.data?.unread ?? 0;
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const closeMenu = () => { if (ref.current) ref.current.open = false; };
  return (
    <details className="bell-menu" id="bell-menu" ref={ref} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void q.refetch(); }}>
      <summary aria-label={`Thông báo${n ? `, ${n} chưa đọc` : ''}`}>
        <Svg size={20}>{P.bell}</Svg>
        {n ? <span className="bell-badge">{n > 99 ? '99+' : n}</span> : null}
      </summary>
      <div className="bell-dropdown" id="bell-dropdown">
        {!q.data ? <Loading /> : (
          <>
            <div className="bell-head"><h3>Thông báo</h3>{q.data.unread ? <button className="link-button" onClick={() => void readAll()}>Đánh dấu tất cả đã đọc</button> : null}</div>
            {q.data.items.length ? q.data.items.slice(0, 8).map((x) => <NotiItem key={x.id} n={x} onOpen={closeMenu} />) : <p className="muted small bell-empty">Chưa có thông báo.</p>}
            <Link className="bell-all" to="/thong-bao" onClick={closeMenu}>Xem tất cả thông báo</Link>
          </>
        )}
      </div>
    </details>
  );
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { session } = useSession();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && ref.current) ref.current.open = false; };
    document.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, []);
  if (!session) return null;
  const u = session.user;
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details className="user-menu" ref={ref}>
      <summary aria-label={`Tài khoản của ${u.name}`}>
        <span className="avatar account-avatar" aria-hidden="true">{u.initials}</span>
        <span className="user-text"><strong>{u.name}</strong><small>{u.roleSummary}</small></span>
        <span className="caret" aria-hidden="true" />
      </summary>
      <div className="user-dropdown">
        <div className="user-head"><strong>{u.name}</strong><small>{u.email}</small></div>
        <Link className="menu-item" to={`/ho-so?id=${u.id}`} onClick={close}>Hồ sơ của tôi</Link>
        <Link className="menu-item" to="/doi-mat-khau" onClick={close}>Đổi mật khẩu</Link>
        <button type="button" className="menu-item danger" onClick={() => { close(); onLogout(); }}>Đăng xuất</button>
      </div>
    </details>
  );
}

// ---------------- Cảnh báo hạn sau đăng nhập ----------------
/** Nhãn hạn: "Trễ 10 ngày" / "Còn 5 giờ" / "Còn 2 ngày". */
function dueLabel(due: string, overdue: boolean): string {
  const ms = toDate(due).getTime() - Date.now();
  if (overdue || ms < 0) return `Trễ ${Math.max(1, Math.ceil(-ms / DAY))} ngày`;
  return ms < DAY ? `Còn ${Math.max(1, Math.round(ms / 3600000))} giờ` : `Còn ${Math.ceil(ms / DAY)} ngày`;
}

function DueAlert() {
  const { session } = useSession();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<DueAlertDto | null>(null);
  const [mute, setMute] = useState(false);
  const [filter, setFilter] = useState<'all' | 'late' | 'soon'>('all');
  const key = `khoa.dueAlert.${session?.user.id}.${todayIso()}`;
  useEffect(() => {
    if (!session) return;
    try { if (localStorage.getItem(key) || sessionStorage.getItem(key)) return; } catch { /* trình duyệt chặn lưu trữ: vẫn hiện */ }
    get<DueAlertDto>('/api/canh-bao-han').then((d) => {
      if (!d.overdue.length && !d.dueSoon.length) return;
      try { sessionStorage.setItem(key, '1'); } catch { /* bỏ qua */ }
      setData(d);
    }).catch(() => {});
  }, [session, key]);
  useEffect(() => { const d = ref.current; if (data && d && !d.open) d.showModal(); }, [data]);
  if (!data) return null;
  const items = [...data.overdue, ...data.dueSoon];
  const shown = filter === 'late' ? data.overdue : filter === 'soon' ? data.dueSoon : items;
  const close = (then?: () => void) => {
    if (mute) { try { localStorage.setItem(key, '1'); } catch { /* bỏ qua */ } }
    closeDialog(ref.current, () => { setData(null); then?.(); });
  };
  const go = (to: string) => close(() => navigate(to));
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const tabs: ['all' | 'late' | 'soon', string, number][] = [['all', 'Tất cả', items.length], ['late', 'Quá hạn', data.overdue.length], ['soon', 'Sắp đến hạn', data.dueSoon.length]];
  return (
    <dialog ref={ref} className="due-alert" aria-labelledby="due-alert-title" aria-describedby="due-alert-sub" onCancel={(e) => { e.preventDefault(); close(); }}>
      <header className="due-head">
        <span className={`due-ico ${data.overdue.length ? 'late' : 'soon'}`} aria-hidden="true"><Glyph name={data.overdue.length ? 'alert' : 'clock'} size={22} /></span>
        <div className="due-head-text">
          <p className="due-eyebrow">{today.charAt(0).toUpperCase() + today.slice(1)}</p>
          <h2 id="due-alert-title" tabIndex={-1} autoFocus>{items.length} công việc cần bạn chú ý</h2>
          <p id="due-alert-sub" className="due-sub">
            {data.overdue.length ? <span className="due-count late"><i />{data.overdue.length} đã quá hạn</span> : null}
            {data.dueSoon.length ? <span className="due-count soon"><i />{data.dueSoon.length} đến hạn trong 3 ngày</span> : null}
          </p>
        </div>
        <button type="button" className="due-close" aria-label="Đóng" onClick={() => close()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {data.overdue.length && data.dueSoon.length ? (
        <div className="due-tabs" role="tablist" aria-label="Lọc cảnh báo">
          {tabs.map(([k, l, n]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<b>{n}</b></button>)}
        </div>
      ) : null}
      <ul className="due-list">
        {shown.map((x) => {
          const late = x.overdue, p = pct(x.progress);
          return (
            <li key={`${x.taskId}-${x.assignmentId ?? 'm'}`}>
              <a className={`due-item ${late ? 'late' : 'soon'}`} href={`#/cong-viec/chi-tiet?id=${x.taskId}`} onClick={(e) => { e.preventDefault(); go(`/cong-viec/chi-tiet?id=${x.taskId}`); }}>
                <span className="due-item-main">
                  <strong>{x.title}</strong>
                  <span className="due-item-meta">
                    <span>{x.unitName}</span>
                    <span className={`due-tag ${x.relation}`}>{x.relation === 'manager' ? 'Việc bạn quản lý' : 'Việc của bạn'}</span>
                  </span>
                  <span className="due-progress" aria-label={`Tiến độ ${p}%`}><span className="due-track"><i style={{ width: `${Math.min(100, p)}%` }} /></span><small>{p}%</small></span>
                </span>
                <span className="due-when">
                  <b>{dueLabel(x.due, late)}</b>
                  <small>Hạn {fmtShort(x.due)}</small>
                </span>
                <Glyph name="chevron" size={16} className="due-go" />
              </a>
            </li>
          );
        })}
      </ul>
      <footer className="due-foot">
        <label className="due-mute"><input type="checkbox" id="mute-today" checked={mute} onChange={(e) => setMute(e.target.checked)} /><span>Không nhắc lại hôm nay</span></label>
        <div className="due-actions">
          <button type="button" className="button secondary" onClick={() => close()}>Để sau</button>
          <button type="button" className="button" onClick={() => go('/cong-viec?scope=assigned&soon=1')}>Xem tất cả<Glyph name="arrow" size={16} /></button>
        </div>
      </footer>
    </dialog>
  );
}

// ---------------- Khung trang ----------------
function NavGroup({ items, active, mobile }: { items: MenuItem[]; active: string; mobile: boolean }) {
  const groups = new Map<string, MenuItem[]>();
  items.filter((m) => m.visible && !(mobile && DESKTOP_ONLY.has(m.path))).forEach((m) => groups.set(m.group, [...(groups.get(m.group) ?? []), m]));
  return (
    <>
      {[...groups.entries()].map(([g, list]) => (
        <Fragment key={g}>
          <div className="nav-label">{g}</div>
          <nav aria-label={g}>
            {list.map((m) => {
              const on = active === m.path;
              return (
                <Link key={m.path} className={`nav-link ${on ? 'active' : ''}`} to={m.path} aria-current={on ? 'page' : undefined}>
                  <Glyph name={m.icon} />
                  <span>{m.label}</span>
                  {m.badge ? <span className="nav-badge" aria-label={`${m.badge} việc`}>{m.badge}</span> : null}
                </Link>
              );
            })}
          </nav>
        </Fragment>
      ))}
    </>
  );
}

function activeMenuPath(path: string): string {
  if (['/cong-viec/chi-tiet', '/cong-viec/tao', '/cong-viec/sua'].includes(path)) return '/cong-viec';
  if (['/nhan-su', '/ho-so', '/them-nhan-su', '/sua-nhan-su'].includes(path)) return '/nhan-su';
  if (['/them-don-vi', '/them-thanh-vien'].includes(path)) return '/to-chuc';
  return path;
}

/** Thanh điều hướng dưới cùng trên điện thoại (CSS chỉ hiện khi màn hình ≤ 720px). */
function MobileTabBar({ path, home, canCreate, taskBadge }: { path: string; home: string; canCreate: boolean; taskBadge: number }) {
  const { session } = useSession();
  const unread = useNotifications().data?.unread ?? 0;
  const search = new URLSearchParams(useLocation().search);
  const me = session ? `/ho-so?id=${session.user.id}` : '/doi-mat-khau';
  const tab = (to: string, on: boolean, label: string, icon: React.ReactNode, badge = 0) => (
    <Link to={to} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
      <span className="m-tab-ico">{icon}{badge ? <b className="m-tab-badge">{badge > 99 ? '99+' : badge}</b> : null}</span>
      <span>{label}</span>
    </Link>
  );
  const taskOn = path.startsWith('/cong-viec') && path !== '/cong-viec/tao' || path === '/cho-duyet';
  return (
    <nav className={`m-tabbar ${canCreate ? '' : 'no-fab'}`} aria-label="Điều hướng nhanh">
      {tab(home, path === home, 'Trang chủ', <Glyph name="dashboard" size={22} />)}
      {tab('/cong-viec', taskOn, 'Công việc', <Glyph name="tasks" size={22} />, taskBadge)}
      {canCreate ? <Link to="/cong-viec/tao" className={`m-fab ${path === '/cong-viec/tao' ? 'on' : ''}`} aria-label="Tạo công việc"><Glyph name="plus" size={24} /></Link> : null}
      {tab('/thong-bao', path === '/thong-bao', 'Thông báo', <Svg size={22}>{P.bell}</Svg>, unread)}
      {tab(me, (path === '/ho-so' && search.get('id') === String(session?.user.id)) || path === '/doi-mat-khau', 'Tôi', <Glyph name="user" size={22} />)}
    </nav>
  );
}

/** Trang quản trị mở trên điện thoại: nhắc dùng máy tính thay vì hiện giao diện chật chội. */
function DesktopOnly() {
  return (
    <div className="desktop-only card">
      <span className="desktop-only-ico"><Glyph name="settings" size={28} /></span>
      <h1 id="page-title" tabIndex={-1}>Chức năng dùng trên máy tính</h1>
      <p className="muted">Phần quản trị (chức vụ, thể loại, mẫu công việc, nhật ký, thêm nhân sự và đơn vị) chỉ có trên bản máy tính để thao tác chính xác hơn.</p>
      <div className="actions">
        <Link className="button" to="/cong-viec">Xem công việc</Link>
        <Link className="button secondary" to="/thong-bao">Thông báo</Link>
      </div>
    </div>
  );
}

/** Gắn nhãn cột (lấy từ tiêu đề bảng) cho mọi ô để trên điện thoại bảng hiện thành thẻ, không phải vuốt ngang. */
function labelTables(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>('table:not(.task-table)').forEach((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    table.classList.add('m-cards');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (i > 0 && heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]);
      });
    });
  });
}

function useMobileTables() {
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!main) return;
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { labelTables(document); }); };
    run();
    const mo = new MutationObserver(run);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
}

export function Shell() {
  const s = useSession();
  const access = useAccess();
  const loc = useLocation();
  const navigate = useNavigate();
  const { toast } = useUi();
  const [menu, setMenu] = useState(false);
  const review = useTaskList('review', access.canReviewAny);
  useMobileTables();
  const mobile = useIsMobile();
  // Chỉ cuộn lên đầu khi sang trang khác; đổi bộ lọc/tìm kiếm (?q=…) giữ nguyên vị trí đang xem.
  useEffect(() => { setMenu(false); }, [loc.pathname, loc.search]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  if (!s.session) return <Navigate to="/" replace />;
  const path = loc.pathname;
  const params = new URLSearchParams(loc.search);
  if (!access.canOpen(path, params)) return <Navigate to={'/' + s.defaultPortal} replace />;

  // Điện thoại không có Bảng quản trị: về Trang cá nhân nếu có, không thì về danh sách công việc.
  const hasPersonal = s.portals.some((p) => p.key === 'ca-nhan');
  const mobileHome = mobile && DESKTOP_ONLY.has('/' + s.defaultPortal) ? (hasPersonal ? '/ca-nhan' : '/cong-viec') : '/' + s.defaultPortal;
  if (mobile && path === '/admin' && hasPersonal) return <Navigate to="/ca-nhan" replace />;
  const active = activeMenuPath(path);
  const taskMenu = access.taskMenu.map((m) => (m.path === '/cho-duyet' ? { ...m, badge: review.data?.counts.review ?? 0 } : m));
  const portal = s.portals.find((p) => '/' + p.key === path);
  const crumb = portal?.title ?? TASK_LABELS[path] ?? access.orgMenu.find((m) => m.path === active)?.label ?? (path === '/doi-mat-khau' ? 'Đổi mật khẩu' : 'Tổ chức');
  const logout = async () => {
    try { await s.logout(); } catch (e) { toast((e as Error).message, true); return; }
    navigate('/', { replace: true });
    toast('Đã đăng xuất.');
  };

  // Trang nhập liệu: trên điện thoại ẩn thanh dưới, ghim nút Lưu ở đáy màn hình.
  const formPage = ['/cong-viec/tao', '/cong-viec/sua', '/them-nhan-su', '/sua-nhan-su', '/them-don-vi', '/them-thanh-vien', '/doi-mat-khau'].includes(path);

  return (
    <div className={`shell ${formPage ? 'is-form' : ''}`}>
      <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Chuyển đến nội dung</a>
      <aside className={`sidebar ${menu ? 'open' : ''}`} id="sidebar" aria-label="Thanh điều hướng">
        <Link className="brand" to="/"><span className="brand-mark"><Glyph name="tasks" size={19} /></span><span><span className="brand-name">Quản lý công việc</span><small>Khoa Công nghệ Thông tin</small></span></Link>
        <div className="nav-label">TRANG CỦA TÔI</div>
        <nav aria-label="Trang theo vai trò">
          {s.portals.filter((p) => !(mobile && DESKTOP_ONLY.has('/' + p.key))).map((p) => {
            const on = path === '/' + p.key, ico = PORTAL_ICONS[p.key] ?? 'dashboard';
            return <Link key={p.key} className={`nav-link ${on ? 'active' : ''}`} to={'/' + p.key} aria-current={on ? 'page' : undefined}><Glyph name={ico} /><span>{p.title}</span></Link>;
          })}
        </nav>
        <NavGroup items={taskMenu} active={active} mobile={mobile} />
        <NavGroup items={access.orgMenu} active={active} mobile={mobile} />
      </aside>
      <div className={`menu-scrim ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} />
      <div className="main">
        <div className="topbar">
          <button className="mobile-menu" aria-label="Mở menu" aria-controls="sidebar" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Svg size={20}><path d="M4 7h16M4 12h16M4 17h10" /></Svg></button>
          <span className="breadcrumb-first">Không gian làm việc</span>
          <Icon name="chevron" />
          <span className="current">{crumb}</span>
          {access.canCreate && !['/cong-viec/tao', '/cong-viec'].includes(path) && !portal ? <Link className="button small topbar-create" to="/cong-viec/tao"><Glyph name="plus" size={16} /><span>Tạo công việc</span></Link> : null}
          <Bell />
          <UserMenu onLogout={() => void logout()} />
        </div>
        <main className="content" id="main-content" tabIndex={-1}>
          <div className="page-anim" key={path}>{mobile && DESKTOP_ONLY.has(path) ? <DesktopOnly /> : <Outlet />}</div>
        </main>
      </div>
      <MobileTabBar path={path} home={mobileHome} canCreate={access.canCreate} taskBadge={review.data?.counts.review ?? 0} />
      <DueAlert />
    </div>
  );
}
