import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, CalendarDays, CheckCheck, Clock3, FileText, Info, ListTodo, MessageCircle, RefreshCw, UsersRound, type LucideIcon } from 'lucide-react';
import type { NotificationDto } from '@khoa/shared';
import { api } from '../api';
import { PageHeader, StateView, useNotifications, useUi } from '../ui';
import { addDays, isoDay, relative, todayIso } from '../format';

/** Biểu tượng + màu theo loại thông báo của hệ thống. */
const KIND: Record<string, [LucideIcon, string]> = {
  GiaoViec: [ListTodo, 'bg-blue-100 text-primary'],
  QuaHan: [AlertCircle, 'bg-red-100 text-red-600'],
  SapDenHan: [Clock3, 'bg-orange-100 text-orange-600'],
  ChamTienDo: [Clock3, 'bg-orange-100 text-orange-600'],
  GiaHan: [CalendarDays, 'bg-amber-100 text-amber-700'],
  KetQua: [FileText, 'bg-violet-100 text-violet-600'],
  TiepNhan: [UsersRound, 'bg-emerald-100 text-emerald-700'],
  BinhLuan: [MessageCircle, 'bg-sky-100 text-sky-700'],
  LapLai: [RefreshCw, 'bg-blue-100 text-primary'],
  HeThong: [Info, 'bg-slate-100 text-slate-500'],
};

export function NotificationsPage() {
  const q = useNotifications();
  const qc = useQueryClient();
  const { notify } = useUi();
  const navigate = useNavigate();
  const items = q.data?.items ?? [];
  const today = todayIso(), yesterday = addDays(today, -1);
  const groups: [string, NotificationDto[]][] = [['Hôm nay', []], ['Hôm qua', []], ['Trước đó', []]];
  items.forEach((n) => { const d = isoDay(n.createdAt); groups[d === today ? 0 : d === yesterday ? 1 : 2][1].push(n); });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notif'] });
  const open = (n: NotificationDto) => {
    if (!n.read) api('POST', `/api/thong-bao/${n.id}/da-doc`).then(refresh).catch(() => {});
    if (n.taskId) navigate(`/tasks/${n.taskId}`);
  };
  return (
    <>
      <PageHeader title="Thông báo" subtitle={q.data ? (q.data.unread ? `${q.data.unread} thông báo chưa đọc` : 'Bạn đã đọc hết thông báo') : 'Đang tải...'}
        action={q.data?.unread ? (
          <button aria-label="Đánh dấu tất cả đã đọc" className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary active:scale-95"
            onClick={async () => { try { await api('POST', '/api/thong-bao/da-doc-tat-ca'); refresh(); notify('Đã đánh dấu tất cả là đã đọc'); } catch (e) { notify((e as Error).message, true); } }}>
            <CheckCheck size={21} />
          </button>
        ) : undefined} />
      {!q.data ? (q.error ? <StateView kind="error" text={(q.error as Error).message} /> : <StateView kind="loading" />)
        : !items.length ? <StateView kind="empty" title="Chưa có thông báo" text="Khi có việc được giao, sắp đến hạn hay có người bình luận, thông báo sẽ hiện ở đây." />
          : groups.filter(([, list]) => list.length).map(([label, list]) => (
            <section key={label} className="mb-7">
              <h2 className="mb-3 text-[12px] font-bold text-slate-500">{label}</h2>
              {list.map((n) => {
                const [Icon, tone] = KIND[n.type] ?? [Bell, 'bg-blue-100 text-primary'];
                return (
                  <button key={n.id} onClick={() => open(n)}
                    className={`mb-2 flex w-full gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${n.read ? 'border-border bg-white' : 'border-blue-100 bg-[#edf2ff]'}`}>
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={19} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold leading-5">{n.title}</span>
                      <span className="mt-1 block text-[12px] leading-5 text-slate-500">{n.content}</span>
                      <span className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">{relative(n.createdAt)}{n.needsAction ? <b className="rounded-md bg-orange-50 px-1.5 py-0.5 font-semibold text-orange-600">Cần xử lý</b> : null}</span>
                    </span>
                    {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Chưa đọc" /> : null}
                  </button>
                );
              })}
            </section>
          ))}
    </>
  );
}
