import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, ClipboardCheck, Clock3, LayoutGrid, RefreshCw } from 'lucide-react';
import type { TaskSummaryDto } from '@khoa/shared';
import { useSession } from '../session';
import { Avatar, CreateButton, SectionTitle, StateView, TaskCard, useTaskList, useUi } from '../ui';
import { isoDay, time, todayIso } from '../format';

const OPEN = [1, 2, 3, 5];
const dueOf = (t: TaskSummaryDto) => t.myDue || t.due;
/** Mức khẩn: quá hạn → chờ tôi duyệt → hạn gần nhất. */
const urgency = (t: TaskSummaryDto) => (t.overdue ? 0 : t.pendingReviews ? 1 : 2) * 1e13 + (dueOf(t) ? new Date(dueOf(t)!).getTime() : 9e12);

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
}

export function HomePage() {
  const { session, isMember, canReview, canCreate } = useSession();
  const { notify } = useUi();
  const qc = useQueryClient();
  const scope = isMember ? 'assigned' : 'all';
  const list = useTaskList(scope);
  const review = useTaskList('review', canReview);
  const user = session!.user;
  const firstName = user.name.trim().split(/\s+/).slice(-1)[0];
  const today = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  if (!list.data) return list.error ? <StateView kind="error" text={(list.error as Error).message} /> : <StateView kind="loading" />;
  const items = list.data.items.filter((t) => t.status !== 6 && t.status !== 0);
  const open = items.filter((t) => OPEN.includes(t.status));
  const progressOf = (t: TaskSummaryDto) => (t.assignedToMe && t.myProgress != null ? t.myProgress : t.progress);
  const percentage = open.length ? Math.round(open.reduce((s, t) => s + progressOf(t), 0) / open.length) : 100;
  const done = items.filter((t) => t.status === 4).length;
  const doing = items.filter((t) => t.status === 2).length;
  const overdue = open.filter((t) => t.overdue).length;
  const soon = open.filter((t) => !t.overdue && t.dueSoon).length;
  const toReview = review.data?.counts.review ?? 0;
  const focus = [...open].sort((a, b) => urgency(a) - urgency(b)).slice(0, 3);
  const upcoming = open.filter((t) => dueOf(t) && isoDay(dueOf(t)!) > todayIso()).sort((a, b) => new Date(dueOf(a)!).getTime() - new Date(dueOf(b)!).getTime()).slice(0, 3);
  const C = 2 * Math.PI * 48;

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-slate-400">{today}</p>
          <h1 className="text-[23px] font-extrabold leading-8">{greeting()},<br />{firstName}</h1>
          <p className="mt-2 text-[13px] text-slate-500">{open.length ? `${open.length} việc đang mở${soon ? ` · ${soon} sắp đến hạn` : ''}` : 'Không có việc nào đang mở.'}</p>
        </div>
        <Link to="/profile" aria-label="Hồ sơ cá nhân" className="self-start"><Avatar name={user.initials} /></Link>
      </div>

      {canCreate ? <CreateButton className="mb-6 w-full" /> : null}

      <div className="relative mb-6 overflow-hidden rounded-[24px] bg-gradient-to-br from-[#3262ec] via-[#315ad4] to-[#2448ad] p-5 text-white shadow-[0_8px_24px_#3563ee20]">
        <div className="absolute -right-12 -top-20 size-56 rounded-full border-[35px] border-white/[0.035]" />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-semibold text-blue-100">
            <span className="flex size-6 items-center justify-center rounded-lg bg-white/15"><LayoutGrid size={13} /></span>
            {isMember ? 'CÔNG VIỆC CỦA BẠN' : 'TỔNG QUAN CÔNG VIỆC'}
          </span>
          <button aria-label="Làm mới tổng quan" className="flex size-11 items-center justify-center rounded-full bg-white/10 active:scale-95"
            onClick={async () => { await qc.invalidateQueries({ queryKey: ['list'] }); notify('Đã cập nhật dữ liệu mới nhất'); }}>
            <RefreshCw size={15} className={list.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="relative my-4 flex items-center gap-5">
          <div className="relative flex size-[112px] shrink-0 items-center justify-center">
            <svg viewBox="0 0 112 112" className="absolute size-full -rotate-90" aria-label={`${percentage} phần trăm tiến độ trung bình`}>
              <circle cx="56" cy="56" r="48" fill="none" stroke="#ffffff24" strokeWidth="7" />
              <circle cx="56" cy="56" r="48" fill="none" stroke="#d2e0ff" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(percentage / 100) * C} ${C}`} className="transition-[stroke-dasharray] duration-700" />
            </svg>
            <div className="text-center">
              <p className="text-[29px] font-bold">{percentage}<span className="text-base">%</span></p>
              <p className="mt-0.5 text-[10px] text-blue-100">trung bình</p>
            </div>
          </div>
          <div>
            <h2 className="text-[18px] font-bold leading-7">{overdue ? <>Còn {overdue} việc<br />đang trễ hạn</> : open.length ? <>Mọi việc<br />đang đúng hạn</> : <>Đã xong<br />mọi việc</>}</h2>
            <p className="mt-2 text-[12px] leading-5 text-blue-100">{done} trên {items.length} công việc<br />đã hoàn thành.</p>
          </div>
        </div>
        <div className="relative grid grid-cols-3 border-t border-white/15 pt-4">
          <Link to="/tasks">
            <p className="text-[21px] font-bold">{String(items.length).padStart(2, '0')}<span className="ml-1 text-[11px] font-normal text-blue-200">việc</span></p>
            <p className="mt-1 text-[11px] text-blue-100">Tổng công việc</p>
          </Link>
          <Link to="/tasks?status=doing" className="border-l border-white/15 pl-5">
            <p className="text-[21px] font-bold">{String(doing).padStart(2, '0')}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-blue-100"><span className="size-1 rounded-full bg-sky-300" />Đang làm</p>
          </Link>
          <Link to="/tasks?status=late" className="border-l border-white/15 pl-5">
            <p className="text-[21px] font-bold text-[#ffd1b3]">{String(overdue).padStart(2, '0')}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-blue-100"><span className="size-1 rounded-full bg-orange-300" />Quá hạn</p>
          </Link>
        </div>
      </div>

      {toReview ? (
        <Link to="/tasks?scope=review" className="mb-3 flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50 px-3.5 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600"><ClipboardCheck size={17} /></span>
          <p className="flex-1 text-[12px] leading-[18px] text-violet-800"><strong className="font-bold">{toReview} việc chờ bạn duyệt</strong><br />Kết quả nộp lên và yêu cầu gia hạn.</p>
          <ArrowRight size={17} className="text-violet-500" />
        </Link>
      ) : null}
      {overdue + soon ? (
        <Link to={overdue ? '/tasks?status=late' : '/tasks?due=soon'} className="mb-6 flex items-center gap-3 rounded-xl border border-[#f2e5d4] bg-[#fff8ed] px-3.5 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#fcebd3] text-[#b98542]"><Clock3 size={17} /></span>
          <p className="flex-1 text-[12px] leading-[18px] text-[#8a704d]"><strong className="font-bold">{overdue + soon} công việc cần bạn chú ý</strong><br />{overdue ? `${overdue} quá hạn` : ''}{overdue && soon ? ', ' : ''}{soon ? `${soon} đến hạn trong 3 ngày` : ''}.</p>
          <ArrowRight size={17} className="text-[#b98542]" />
        </Link>
      ) : <div className="mb-6" />}

      <SectionTitle to="/tasks">Tập trung hôm nay <span className="ml-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs text-primary">{String(focus.length).padStart(2, '0')}</span></SectionTitle>
      {focus.length ? focus.map((t) => <TaskCard key={t.id} task={t} />) : <p className="mb-4 rounded-2xl border border-border bg-white p-4 text-[13px] text-slate-500">Không có việc nào cần tập trung. Nghỉ ngơi một chút nhé.</p>}

      {upcoming.length ? (
        <div className="mt-6">
          <SectionTitle to="/tasks" action="Tất cả hạn">Sắp tới</SectionTitle>
          {upcoming.map((t, i) => {
            const d = new Date(dueOf(t)!);
            const day = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit' }).format(d);
            const month = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', month: 'numeric' }).format(d);
            return (
              <Link key={t.id} to={`/tasks/${t.id}`} className="mb-4 flex items-center gap-3">
                <div className={`flex size-11 flex-col items-center justify-center rounded-xl ${['bg-blue-100 text-blue-600', 'bg-purple-100 text-purple-600', 'bg-emerald-100 text-emerald-700'][i % 3]}`}>
                  <span className="text-[17px] font-bold leading-5">{day}</span><span className="text-[9px] font-semibold">TH{month}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">{t.title}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-400">{time(d)} · {t.unitName}</p>
                </div>
                <ChevronRight size={15} className="text-slate-300" />
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
