import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, RouterProvider, createHashRouter, useLocation } from 'react-router-dom';
import { Bell, Eye, EyeOff, GraduationCap, Home, ListTodo, UserRound } from 'lucide-react';
import { useSession } from './session';
import { FieldError, StateView, button, field, useNotifications, useTaskList } from './ui';
import { HomePage } from './screens/Home';
import { TasksPage, FilterPage } from './screens/Tasks';
import { TaskDetail } from './screens/TaskDetail';
import { UpdatePage, SubmitPage } from './screens/TaskActions';
import { CreatePage } from './screens/Create';
import { NotificationsPage } from './screens/Notifications';
import { ProfilePage } from './screens/Profile';

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 text-[15px] font-extrabold">
      <span className="flex size-7 items-center justify-center rounded-[9px] bg-primary text-white"><GraduationCap size={19} /></span>
      Công việc
      <span className="ml-1 border-l border-slate-200 pl-3 text-[9.5px] font-semibold tracking-[0.08em] text-slate-400">KHOA CÔNG NGHỆ THÔNG TIN</span>
    </Link>
  );
}

function Layout() {
  const { session, canReview } = useSession();
  const loc = useLocation();
  const unread = useNotifications(!!session).data?.unread ?? 0;
  const review = useTaskList('review', !!session && canReview).data?.counts.review ?? 0;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  const tabs = [
    { to: '/', icon: Home, label: 'Trang chủ', badge: 0 },
    { to: '/tasks', icon: ListTodo, label: 'Công việc', badge: review },
    { to: '/notifications', icon: Bell, label: 'Thông báo', badge: unread },
    { to: '/profile', icon: UserRound, label: 'Cá nhân', badge: 0 },
  ];
  return (
    <>
      <div className="flex items-center justify-between px-6 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <Brand />
        <span className="size-1.5 rounded-full bg-emerald-500" title="Đã kết nối" />
      </div>
      <main key={loc.pathname} className="animate-enter px-6 pb-32 pt-5">
        <Outlet />
      </main>
      <nav aria-label="Điều hướng chính" className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-[440px] -translate-x-1/2 justify-around border-t border-border bg-white/95 px-2 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        {tabs.map(({ to, icon: Icon, label, badge }) => (
          <NavLink end={to === '/'} key={to} to={to}
            className={({ isActive }) => `flex min-h-12 flex-1 flex-col items-center gap-1 text-[10.5px] font-semibold ${isActive ? 'text-primary' : 'text-slate-400'}`}>
            {({ isActive }) => (
              <>
                <span className={`relative flex h-7 w-12 items-center justify-center rounded-xl transition ${isActive ? 'bg-blue-50' : ''}`}>
                  <Icon size={20} strokeWidth={isActive ? 2.4 : 1.7} />
                  {badge ? <span className="absolute -right-0.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[9.5px] font-bold text-white">{badge > 99 ? '99+' : badge}</span> : null}
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function LoginPage() {
  const { session, login } = useSession();
  const loc = useLocation();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  if (session) return <Navigate to={(loc.state as { from?: string } | null)?.from ?? '/'} replace />;
  return (
    <div className="flex min-h-dvh flex-col px-6 pb-10 pt-[max(48px,env(safe-area-inset-top))]">
      <Brand />
      <div className="mt-14 mb-8">
        <h1 className="text-[28px] font-extrabold leading-tight">Đăng nhập</h1>
        <p className="mt-2 text-[13px] leading-6 text-slate-500">Dùng tài khoản email của trường để xem và cập nhật công việc được giao.</p>
      </div>
      <form className="space-y-5" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const email = String(fd.get('email') || ''), password = String(fd.get('password') || '');
        const errs: Record<string, string> = {};
        if (!email.trim()) errs.email = 'Nhập email.';
        if (!password) errs.password = 'Nhập mật khẩu.';
        if (Object.keys(errs).length) { setErrors(errs); return; }
        setBusy(true);
        try { setErrors(await login(email, password)); } catch (err) { setErrors({ form: (err as Error).message }); } finally { setBusy(false); }
      }}>
        {errors?.form ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-[13px] font-medium text-red-600">{errors.form}</p> : null}
        <label className="block text-xs font-bold">Email
          <input name="email" type="email" autoComplete="username" inputMode="email" placeholder="ten@huit.edu.vn" className={`${field} mt-2.5`} aria-invalid={!!errors?.email} />
          <FieldError text={errors?.email} />
        </label>
        <label className="block text-xs font-bold">Mật khẩu
          <span className="relative mt-2.5 block">
            <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" className={`${field} pr-12`} aria-invalid={!!errors?.password} />
            <button type="button" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShow(!show)} className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-slate-400">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          <FieldError text={errors?.password} />
        </label>
        <button className={`${button} w-full`} disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
      <p className="mt-auto pt-10 text-center text-[11px] leading-5 text-slate-400">Quên mật khẩu? Liên hệ văn phòng khoa để được cấp lại.</p>
    </div>
  );
}

function Root() {
  const { ready } = useSession();
  if (!ready) return <div className="px-6 pt-16"><StateView kind="loading" title="Đang kết nối máy chủ..." /></div>;
  return <Outlet />;
}

const router = createHashRouter([
  {
    element: <Root />,
    children: [
      { path: 'login', element: <LoginPage /> },
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'review', element: <Navigate to="/tasks?scope=review" replace /> },
          { path: 'tasks/:id', element: <TaskDetail /> },
          { path: 'tasks/:id/update', element: <UpdatePage /> },
          { path: 'tasks/:id/submit', element: <SubmitPage /> },
          { path: 'filter', element: <FilterPage /> },
          { path: 'create', element: <CreatePage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <StateView kind="error" title="Không tìm thấy trang" text="Đường dẫn không đúng hoặc nội dung đã bị xóa." action={<Link to="/" className={`${button} mx-auto w-fit`}>Về trang chủ</Link>} /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
