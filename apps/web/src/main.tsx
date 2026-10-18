import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, Outlet, RouterProvider, createHashRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { SessionProvider, useSession } from './session';
import { UiProvider, useUi } from './ui/ui';
import { Shell } from './layout/Shell';
import { LoginPage, StatusPage } from './pages/Login';
import { PortalPage } from './pages/Portal';
import {
  MemberFormPage, NotFoundPage, OrganizationPage, PasswordPage, PermissionsPage, PersonFormPage, ProfilePage, StaffPage, UnitFormPage,
} from './pages/Organization';
import { TaskActionsProvider } from './tasks/dialogs';
import { TaskListPage } from './tasks/TaskList';
import { TaskDetailPage } from './tasks/TaskDetail';
import { TaskFormPage } from './tasks/TaskForm';
import { PersonalStatsPage, UnitStatsPage } from './tasks/Stats';
import { AuditPage, CategoriesPage, NotificationsPage, TemplatesPage } from './tasks/Admin';
import './styles-scale.css';
import './gv.css';
import './theme.css';
import './typography.css';
import './mobile.css';
import './motion.css';
import { initMotion } from './motion';
import { installHistoryIndex, trackHistoryIndex } from './historyIndex';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Chưa đăng nhập: mọi đường dẫn hiện màn hình đăng nhập. Đã đăng nhập: khung trang + nội dung. */
function Root() {
  const s = useSession();
  const loc = useLocation();
  if (!s.ready) return <StatusPage title="Đang tải…" message="Đang kết nối máy chủ." />;
  if (s.loadError) return <StatusPage title="Không tải được dữ liệu" message={s.loadError} action={<button className="button" onClick={s.retry}>Thử lại</button>} />;
  if (!s.session) return <LoginPage />;
  if (loc.pathname === '/') return <Navigate to={'/' + s.defaultPortal} replace />;
  return <TaskActionsProvider><Shell /></TaskActionsProvider>;
}

function Providers() {
  const { toast } = useUi();
  const expired = useCallback(() => toast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', true), [toast]);
  return <SessionProvider onExpired={expired}><Root /></SessionProvider>;
}

// Phải chạy trước createHashRouter (xem historyIndex.ts).
installHistoryIndex();
const router = createHashRouter([
  {
    path: '/',
    element: <UiProvider><Providers /></UiProvider>,
    children: [
      { index: true, element: <Outlet /> },
      { path: 'admin', element: <PortalPage /> },
      // Trang Trưởng khoa / Trang bộ môn đã gộp vào Trang cá nhân: giữ đường dẫn cũ (dấu trang, thông báo cũ).
      { path: 'truong-khoa', element: <Navigate to="/ca-nhan" replace /> },
      { path: 'truong-bo-mon', element: <Navigate to="/ca-nhan" replace /> },
      { path: 'ca-nhan', element: <PortalPage /> },
      { path: 'to-chuc', element: <OrganizationPage /> },
      { path: 'nhan-su', element: <StaffPage /> },
      { path: 'chuc-vu', element: <PermissionsPage /> },
      { path: 'them-thanh-vien', element: <MemberFormPage /> },
      { path: 'them-don-vi', element: <UnitFormPage /> },
      { path: 'ho-so', element: <ProfilePage /> },
      { path: 'them-nhan-su', element: <PersonFormPage editing={false} /> },
      { path: 'sua-nhan-su', element: <PersonFormPage editing /> },
      { path: 'doi-mat-khau', element: <PasswordPage /> },
      { path: 'cong-viec', element: <TaskListPage /> },
      { path: 'cong-viec/chi-tiet', element: <TaskDetailPage /> },
      { path: 'cong-viec/tao', element: <TaskFormPage editing={false} /> },
      { path: 'cong-viec/sua', element: <TaskFormPage editing /> },
      { path: 'cho-duyet', element: <TaskListPage fixedScope="review" /> },
      { path: 'thong-ke', element: <UnitStatsPage /> },
      { path: 'thong-ke-ca-nhan', element: <PersonalStatsPage /> },
      { path: 'the-loai', element: <CategoriesPage /> },
      { path: 'mau-cong-viec', element: <TemplatesPage /> },
      { path: 'nhat-ky', element: <AuditPage /> },
      { path: 'thong-bao', element: <NotificationsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
trackHistoryIndex(router);

// Hệ thống chuyển động (xuất hiện khi cuộn, đếm số, thanh trên đổ bóng) — gắn một lần cho cả ứng dụng.
initMotion(document.getElementById('app')!);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
