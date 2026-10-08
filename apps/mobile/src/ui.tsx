import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronRight, Clock3, Flag, Folder, ListTodo, Plus, RefreshCw, X, XCircle } from 'lucide-react';
import type { NotificationListDto, TaskDetailDto, TaskListDto, TaskSummaryDto } from '@khoa/shared';
import { get } from './api';
import { friendly, remaining } from './format';

// ---------------- Kiểu dáng dùng chung (theo bản thiết kế) ----------------
export const button =
  'flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-blue-700 disabled:active:scale-100';
export const buttonGhost =
  'flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-white px-5 text-sm font-bold transition active:scale-[0.98]';
export const field =
  'w-full rounded-xl border border-border bg-white px-4 py-3.5 text-sm outline-none focus:border-blue-500';

// ---------------- Thông báo nhanh + chế độ tối ----------------
interface Ui { notify: (message: string, error?: boolean) => void; dark: boolean; setDark: (v: boolean) => void; }
const UiCtx = createContext<Ui>(null!);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }: { children: (dark: boolean) => ReactNode }) {
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [dark, setDarkState] = useState(() => { try { return localStorage.getItem('khoa.m.dark') === '1'; } catch { return false; } });
  const setDark = (v: boolean) => { setDarkState(v); try { localStorage.setItem('khoa.m.dark', v ? '1' : '0'); } catch { /* bỏ qua */ } };
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  }, []);
  return (
    <UiCtx.Provider value={{ notify, dark, setDark }}>
      {children(dark)}
      {toast ? (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 flex w-[calc(100%-48px)] max-w-[392px] -translate-x-1/2 animate-enter items-center gap-3 rounded-2xl bg-slate-900 px-4 py-4 text-xs font-medium text-white shadow-xl">
          {toast.error ? <XCircle size={19} className="shrink-0 text-red-400" /> : <CheckCircle2 size={19} className="shrink-0 text-emerald-400" />}
          {toast.text}
        </div>
      ) : null}
    </UiCtx.Provider>
  );
}

// ---------------- Truy vấn dữ liệu ----------------
export const useTaskList = (scope: string, enabled = true) =>
  useQuery({ queryKey: ['list', scope], queryFn: () => get<TaskListDto>(`/api/cong-viec?scope=${encodeURIComponent(scope)}`), enabled, staleTime: 30_000 });
export const useTaskDetail = (id: number) =>
  useQuery({ queryKey: ['detail', id], queryFn: () => get<TaskDetailDto>(`/api/cong-viec/${id}`), enabled: id > 0, staleTime: 10_000, retry: false });
export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: ['notif'], queryFn: () => get<NotificationListDto>('/api/thong-bao?limit=60'), enabled, staleTime: 20_000, refetchInterval: () => (document.hidden ? false : 60_000) });

/** Sau mỗi thao tác: làm mới danh sách, thông báo, thống kê và chi tiết. */
export function useAfterChange() {
  const qc = useQueryClient();
  return (taskId?: number) => {
    for (const key of ['list', 'notif', 'stats']) void qc.invalidateQueries({ queryKey: [key] });
    if (taskId) for (const key of ['detail', 'comments', 'history']) void qc.invalidateQueries({ queryKey: [key, taskId] });
  };
}

// ---------------- Trạng thái, ưu tiên ----------------
/** Nhãn hiển thị theo bản thiết kế; việc đang mở mà đã quá hạn hiện "Quá hạn". */
export function statusOf(t: Pick<TaskSummaryDto, 'status' | 'overdue'>): string {
  if (t.overdue && [1, 2, 5].includes(t.status)) return 'Quá hạn';
  return ({ 0: 'Nháp', 1: 'Chờ làm', 2: 'Đang làm', 3: 'Chờ duyệt', 4: 'Hoàn thành', 5: 'Tạm dừng', 6: 'Đã hủy' } as Record<number, string>)[t.status] ?? 'Chờ làm';
}
const statusStyle: Record<string, string> = {
  'Đang làm': 'bg-blue-50 text-blue-600',
  'Chờ làm': 'bg-amber-50 text-amber-700',
  'Chờ duyệt': 'bg-violet-50 text-violet-600',
  'Quá hạn': 'bg-red-50 text-red-600',
  'Hoàn thành': 'bg-emerald-50 text-emerald-700',
  'Tạm dừng': 'bg-slate-100 text-slate-500',
  'Đã hủy': 'bg-slate-100 text-slate-500',
  'Nháp': 'bg-slate-100 text-slate-500',
};
export const PRIORITY: Record<number, string> = { 1: 'Thấp', 2: 'Vừa', 3: 'Cao', 4: 'Khẩn cấp' };

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${statusStyle[status] || statusStyle['Chờ làm']}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function Avatar({ name = 'N', small = false, large = false }: { name?: string; small?: boolean; large?: boolean }) {
  return (
    <div className={`${small ? 'size-7 text-[10px]' : large ? 'size-20 border-4 text-2xl' : 'size-11 text-sm'} flex shrink-0 items-center justify-center rounded-full border-2 border-white bg-[#e5eafc] font-bold text-[#5469a3]`}>
      {name}
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'red' }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f6]" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${v === 100 ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function SectionTitle({ children, to, action = 'Xem tất cả' }: { children: ReactNode; to?: string; action?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-[17px] font-extrabold">{children}</h2>
      {to ? <Link to={to} className="flex min-h-11 items-center gap-1 text-xs font-bold text-primary">{action}<ChevronRight size={14} /></Link> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, back = false, action }: { title: string; subtitle?: string; back?: boolean | string; action?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3">
        {back ? (
          <button aria-label="Quay lại" className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white"
            onClick={() => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/'))}>
            <ArrowLeft size={20} />
          </button>
        ) : null}
        <h1 className="flex-1 text-[25px] font-extrabold leading-tight">{title}</h1>
        {action}
      </div>
      {subtitle ? <p className="mt-2 text-[13px] leading-5 text-slate-500">{subtitle}</p> : null}
    </header>
  );
}

/** Thẻ công việc: dự án (đơn vị/thể loại), ưu tiên, tiêu đề, trạng thái, hạn, tiến độ, người nhận. */
export function TaskCard({ task }: { task: TaskSummaryDto }) {
  const status = statusOf(task);
  const open = [1, 2, 5].includes(task.status);
  const due = task.myDue || task.due;
  const r = open ? remaining(due) : null;
  const progress = task.assignedToMe && task.myProgress != null ? task.myProgress : task.progress;
  const who = task.assignedToMe ? 'Bạn phụ trách' : task.assignees.length ? task.assignees.map((a) => a.name).slice(0, 2).join(', ') + (task.assignees.length > 2 ? ` +${task.assignees.length - 2}` : '') : 'Chưa giao';
  return (
    <Link to={`/tasks/${task.id}`} className="group mb-3 block rounded-2xl border border-border bg-white p-4 transition hover:border-blue-200 active:scale-[0.99]">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <Folder size={12} className="shrink-0" />
          <span className="truncate">{task.categoryName || task.unitName}</span>
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${task.priority >= 3 ? 'text-[#e78b58]' : 'text-slate-400'}`}>
          <Flag size={11} />{PRIORITY[task.priority]}
        </span>
      </div>
      <h3 className="mb-3 text-[15px] font-bold leading-6 group-hover:text-primary">{task.title}</h3>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Badge status={status} />
        <span className={`flex items-center gap-1 text-[11px] ${r?.late ? 'font-semibold text-red-500' : r?.soon ? 'font-semibold text-amber-600' : 'text-slate-500'}`}>
          <Clock3 size={12} />{friendly(due)}{r?.late ? ` · ${r.text}` : ''}
        </span>
      </div>
      <Progress value={progress} tone={r?.late ? 'red' : undefined} />
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex -space-x-2">{(task.assignees.length ? task.assignees.slice(0, 3) : [{ id: 0, initials: '?' }]).map((a, i) => <Avatar key={`${a.id}-${i}`} name={a.initials} small />)}</div>
          <span className="truncate text-[11px] text-slate-400">{who}</span>
        </div>
        <span className="shrink-0 text-[11px] font-bold text-slate-500">
          {task.pendingReviews ? <span className="mr-2 rounded-md bg-violet-50 px-1.5 py-0.5 text-violet-600">{task.pendingReviews} chờ duyệt</span> : null}
          {Math.round(progress)}%<ArrowUpRight size={12} className="ml-2 inline text-slate-300" />
        </span>
      </div>
    </Link>
  );
}

/** Trạng thái trống / đang tải / lỗi (theo bản thiết kế, bỏ biểu tượng trang trí). */
export function StateView({ kind, title, text, action }: { kind: 'empty' | 'loading' | 'error'; title?: string; text?: string; action?: ReactNode }) {
  if (kind === 'loading') {
    return (
      <div role="status" className="space-y-4 py-6">
        <p className="flex items-center justify-center gap-2 py-3 text-xs text-slate-400"><RefreshCw className="animate-spin" size={15} />{title ?? 'Đang tải dữ liệu...'}</p>
        {[1, 2, 3].map((i) => (
          <div className="animate-pulse rounded-2xl border border-border bg-white p-5" key={i}>
            <div className="mb-5 h-3 w-2/3 rounded bg-slate-100" /><div className="mb-4 h-5 w-full rounded bg-slate-100" /><div className="h-2 w-1/2 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="py-12 text-center">
      <div className={`mx-auto mb-6 flex size-24 items-center justify-center rounded-[30px] ${kind === 'empty' ? 'bg-blue-50 text-primary' : 'bg-orange-50 text-orange-500'}`}>
        {kind === 'empty' ? <ListTodo size={40} strokeWidth={1.4} /> : <AlertCircle size={40} strokeWidth={1.4} />}
      </div>
      <h2 className="mb-3 text-xl font-bold">{title ?? (kind === 'empty' ? 'Không có công việc nào' : 'Chưa thể tải dữ liệu')}</h2>
      <p className="mx-auto mb-6 max-w-72 text-[13px] leading-6 text-slate-500">
        {text ?? (kind === 'empty' ? 'Thử bộ lọc khác hoặc quay lại sau.' : 'Kết nối có thể đang gián đoạn hoặc nội dung không còn tồn tại.')}
      </p>
      {action}
    </div>
  );
}

/** Bảng trượt từ dưới lên (hộp thoại trên điện thoại). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-[440px] animate-sheet overflow-y-auto rounded-t-3xl bg-background p-6 pb-[max(28px,env(safe-area-inset-bottom))]">
        <div className="mx-auto -mt-2 mb-4 h-1.5 w-10 rounded-full bg-slate-300" />
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Đóng" className="flex size-11 items-center justify-center" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function CreateButton({ className = '' }: { className?: string }) {
  return <Link to="/create" className={`${button} ${className}`}><Plus size={17} />Tạo công việc mới</Link>;
}

/** Lỗi theo từng ô (máy chủ trả { errors }). */
export function FieldError({ text }: { text?: string }) {
  return text ? <span className="mt-1.5 block text-[12px] font-medium text-red-500">{text}</span> : null;
}
