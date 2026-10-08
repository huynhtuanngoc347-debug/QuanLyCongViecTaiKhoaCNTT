import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, Plus, Search, SlidersHorizontal } from 'lucide-react';
import type { TaskSummaryDto } from '@khoa/shared';
import { useSession } from '../session';
import { PageHeader, PRIORITY, StateView, TaskCard, button, field, statusOf, useTaskList } from '../ui';
import { normalize } from '../format';

/** Bộ lọc trạng thái (nhãn theo bản thiết kế) → điều kiện trên dữ liệu thật. */
const STATUS: [string, string, (t: TaskSummaryDto) => boolean][] = [
  ['', 'Tất cả', (t) => t.status !== 6],
  ['doing', 'Đang làm', (t) => statusOf(t) === 'Đang làm'],
  ['todo', 'Chờ làm', (t) => statusOf(t) === 'Chờ làm'],
  ['review', 'Chờ duyệt', (t) => t.status === 3],
  ['late', 'Quá hạn', (t) => statusOf(t) === 'Quá hạn'],
  ['done', 'Hoàn thành', (t) => t.status === 4],
];
const DUE: [string, string][] = [['', 'Tất cả'], ['soon', 'Trong 3 ngày'], ['late', 'Đã quá hạn']];

export function TasksPage() {
  const { isMember, canCreate, canReview } = useSession();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') ?? (isMember ? 'assigned' : 'all');
  const reviewing = scope === 'review';
  const list = useTaskList(scope);
  const [search, setSearch] = useState(params.get('q') || '');
  const [byProgress, setByProgress] = useState(false);
  const status = params.get('status') || '';
  const prio = params.get('prio') || '';
  const due = params.get('due') || '';
  const set = (key: string, value: string) => { const n = new URLSearchParams(params); if (value) n.set(key, value); else n.delete(key); setParams(n, { replace: true }); };
  const counts = list.data?.counts;
  const scopes: [string, string, boolean][] = [
    ['assigned', 'Được giao', isMember],
    ['created', 'Tôi đã giao', canCreate || canReview || (counts?.created ?? 0) > 0],
    ['all', 'Tất cả', true],
    ['review', 'Cần tôi duyệt', canReview || (counts?.review ?? 0) > 0],
  ];
  const shown = useMemo(() => {
    const test = STATUS.find(([k]) => k === status)?.[2] ?? STATUS[0][2];
    const q = normalize(search);
    return (list.data?.items ?? [])
      .filter((t) => test(t) && (!prio || String(t.priority) === prio)
        && (!due || (due === 'late' ? t.overdue : (t.dueSoon || t.overdue)))
        && (!q || normalize(`${t.title} ${t.unitName} ${t.categoryName} ${t.assignees.map((a) => a.name).join(' ')}`).includes(q)))
      .sort((a, b) => (byProgress ? b.progress - a.progress : (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1) || (new Date(a.myDue || a.due || 0).getTime() - new Date(b.myDue || b.due || 0).getTime())));
  }, [list.data, status, prio, due, search, byProgress]);
  const filtered = !!(prio || due);

  return (
    <>
      <PageHeader
        title="Công việc"
        subtitle={reviewing ? 'Kết quả nộp lên, yêu cầu gia hạn và xin thôi cần bạn quyết định.' : `${list.data?.items.length ?? '…'} công việc trong nhóm đang xem`}
        action={canCreate ? <Link aria-label="Tạo công việc" to="/create" className="flex size-11 items-center justify-center rounded-xl bg-primary text-white active:scale-95"><Plus size={22} /></Link> : undefined}
      />
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-[#e9edf6] p-1">
        {scopes.filter((s) => s[2]).map(([k, l]) => {
          const n = counts?.[k as keyof typeof counts];
          return (
            <button key={k} onClick={() => { const next = new URLSearchParams(); next.set('scope', k); setParams(next, { replace: true }); }}
              className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-[12.5px] font-bold transition ${scope === k ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}>
              {l}
              {n !== undefined ? <span className={k === 'review' && n ? 'rounded-full bg-red-500 px-1.5 text-[10.5px] leading-[18px] text-white' : 'font-semibold opacity-60'}>{n}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-4 text-slate-400" />
          <input aria-label="Tìm công việc" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên việc, đơn vị, người nhận..." className={`${field} pl-10`} />
        </div>
        <Link aria-label="Bộ lọc công việc" to={`/filter?${new URLSearchParams({ ...Object.fromEntries(params), scope })}`}
          className={`relative flex w-12 items-center justify-center rounded-xl border border-border ${filtered ? 'bg-blue-100 text-primary' : 'bg-white'}`}>
          <SlidersHorizontal size={19} />{filtered ? <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" /> : null}
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {STATUS.map(([k, l]) => (
          <button key={k || 'all'} onClick={() => set('status', k)}
            className={`min-h-10 rounded-full px-4 text-[12px] font-bold transition ${status === k ? 'bg-slate-800 text-white' : 'border border-border bg-white text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-400">{shown.length} CÔNG VIỆC</span>
        <button className="flex min-h-11 items-center gap-1 text-[12px] text-slate-500" onClick={() => setByProgress(!byProgress)}>
          {byProgress ? 'Tiến độ giảm dần' : 'Hạn gần nhất'}<ChevronDown size={14} />
        </button>
      </div>
      {!list.data ? (list.error ? <StateView kind="error" text={(list.error as Error).message} action={<button className={`${button} mx-auto`} onClick={() => void list.refetch()}>Thử lại</button>} /> : <StateView kind="loading" />)
        : shown.length ? shown.map((t) => <TaskCard task={t} key={t.id} />)
          : <StateView kind="empty"
            title={reviewing ? 'Không có gì chờ bạn duyệt' : undefined}
            text={list.data.items.length ? 'Không có việc nào khớp bộ lọc. Thử bỏ bớt điều kiện.' : reviewing ? 'Khi có kết quả nộp lên hoặc yêu cầu gia hạn, việc sẽ hiện ở đây.' : 'Khi có người giao việc, việc sẽ hiện ở đây.'}
            action={list.data.items.length ? <button className={`${button} mx-auto`} onClick={() => setParams(new URLSearchParams({ scope }), { replace: true })}>Bỏ lọc</button> : undefined} />}
    </>
  );
}

export function FilterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(params.get('status') || '');
  const [prio, setPrio] = useState(params.get('prio') || '');
  const [due, setDue] = useState(params.get('due') || '');
  const groups: { title: string; values: [string, string][]; value: string; setter: (v: string) => void }[] = [
    { title: 'Trạng thái', values: STATUS.map(([k, l]) => [k, l]), value: status, setter: setStatus },
    { title: 'Mức độ ưu tiên', values: [['', 'Tất cả'], ...[4, 3, 2, 1].map((p) => [String(p), PRIORITY[p]] as [string, string])], value: prio, setter: setPrio },
    { title: 'Hạn hoàn thành', values: DUE, value: due, setter: setDue },
  ];
  return (
    <>
      <PageHeader title="Tìm kiếm & bộ lọc" back subtitle="Lọc đúng những việc bạn cần tập trung." />
      {groups.map((g) => (
        <section className="mb-8" key={g.title}>
          <h2 className="mb-4 text-sm font-bold">{g.title}</h2>
          <div className="flex flex-wrap gap-2">
            {g.values.map(([v, l]) => (
              <button key={v || 'all'} onClick={() => g.setter(v)}
                className={`min-h-11 rounded-xl border px-4 text-[13px] font-semibold transition ${g.value === v ? 'border-primary bg-blue-50 text-primary' : 'border-border bg-white text-slate-500'}`}>
                {l}{g.value === v ? <Check size={13} className="ml-2 inline" /> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="mt-10 flex gap-3">
        <button className="min-h-12 rounded-2xl border border-border bg-white px-5 text-[13px] font-bold" onClick={() => { setStatus(''); setPrio(''); setDue(''); }}>Đặt lại</button>
        <button className={`${button} flex-1`} onClick={() => {
          const next = new URLSearchParams();
          const scope = params.get('scope'); if (scope) next.set('scope', scope);
          if (status) next.set('status', status); if (prio) next.set('prio', prio); if (due) next.set('due', due);
          navigate(`/tasks?${next}`, { replace: true });
        }}>Áp dụng bộ lọc</button>
      </div>
    </>
  );
}
