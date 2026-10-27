import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TaskSummaryDto, UnitStatsDto } from '@khoa/shared';
import { get } from '../api/client';
import { useAccess } from '../nav';
import { Avatar, Avatars, Badge, Bar, Empty, Loading, Prio, ROLE, STATUS } from '../ui/ui';
import { Glyph } from '../ui/glyph';
import { useTaskList } from '../tasks/queries';
import { useTaskActions } from '../tasks/dialogs';
import { periodOf } from '../tasks/period';
import { useIsMobile } from '../ui/useIsMobile';
import { DAY, addDaysIso, dueInfo, fmtShort, isoDay, pct, todayIso, toDate } from '../format';

/**
 * Bảng điều khiển công việc (trang theo vai trò). Thứ tự ưu tiên:
 * Tổng quan → Cần chú ý → Tiến độ & trạng thái → Giao việc → Thống kê & đánh giá.
 * Chỉ đọc dữ liệu có sẵn (danh sách công việc, thống kê); mọi thao tác đi qua hộp thoại cũ.
 */
type Mode = 'manager' | 'member';
const OPEN = [1, 2, 3, 5];
const dueMs = (t: TaskSummaryDto) => (t.myDue || t.due ? toDate((t.myDue || t.due)!).getTime() : Number.MAX_SAFE_INTEGER);

function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="dash-head">
      <div><h2>{title}</h2>{sub ? <p className="muted small">{sub}</p> : null}</div>
      {action ? <div className="dash-head-action">{action}</div> : null}
    </header>
  );
}

// ---------------- 1. Tổng quan ----------------
/** Một chỉ số: nhãn trên, số dưới; màu chỉ nằm trên số khi cần chú ý (quá hạn, sắp đến hạn). */
export function StatTile({ label, value, note, tone, to }: { label: string; value: number | string; note: string; tone: string; to: string }) {
  return (
    <Link className={`stat-tile tone-${tone}`} to={to}>
      <span className="stat-body"><small>{label}</small><b>{value}</b><span>{note}</span></span>
    </Link>
  );
}

function Overview({ items, base }: { items: TaskSummaryDto[]; base: string }) {
  const open = items.filter((t) => OPEN.includes(t.status));
  const doing = items.filter((t) => t.status === 2).length, notStarted = items.filter((t) => t.status === 1).length;
  const overdue = items.filter((t) => t.overdue).length, soon = items.filter((t) => t.dueSoon && !t.overdue).length;
  const done = items.filter((t) => t.status === 4).length;
  return (
    <div className="stat-grid">
      <StatTile label="Tổng công việc" value={items.length} note={`${open.length} đang mở`} tone="primary" to={base} />
      <StatTile label="Đang thực hiện" value={doing} note={`${notStarted} chưa bắt đầu`} tone="blue" to={`${base}&status=2`} />
      <StatTile label="Sắp đến hạn" value={soon} note="trong 3 ngày tới" tone={soon ? 'amber' : 'neutral'} to={`${base}&soon=1`} />
      <StatTile label="Quá hạn" value={overdue} note={overdue ? 'cần xử lý ngay' : 'không có việc trễ'} tone={overdue ? 'red' : 'neutral'} to={`${base}&overdue=1`} />
      <StatTile label="Hoàn thành" value={done} note={`${items.length ? Math.round((100 * done) / items.length) : 0}% tổng số`} tone="green" to={`${base}&status=4`} />
    </div>
  );
}

// ---------------- 2. Cần chú ý ----------------
function reasonOf(t: TaskSummaryDto): [string, string] | null {
  if (t.overdue) return [`Quá hạn ${Math.max(1, Math.ceil((Date.now() - dueMs(t)) / DAY))} ngày`, 'red'];
  if (t.pendingReviews > 0) return [`${t.pendingReviews} chờ bạn duyệt`, 'amber'];
  if (t.dueSoon) { const d = Math.ceil((dueMs(t) - Date.now()) / DAY); return [d <= 1 ? 'Hết hạn trong 24 giờ' : `Còn ${d} ngày`, 'amber']; }
  if (t.myAssignmentStatus === 0 && OPEN.includes(t.status)) return ['Chờ bạn tiếp nhận', 'blue'];
  return null;
}
const rankOf = (t: TaskSummaryDto) => (t.overdue ? 0 : t.pendingReviews > 0 ? 1 : t.dueSoon ? 2 : t.myAssignmentStatus === 0 ? 3 : 9);

function RowAction({ t }: { t: TaskSummaryDto }) {
  const actions = useTaskActions();
  const running = [1, 2].includes(t.status);
  if (t.pendingReviews > 0) return <Link className="button small" to={`/cong-viec/chi-tiet?id=${t.id}&tab=result`}>Đánh giá</Link>;
  if (t.myAssignmentId && running && t.myAssignmentStatus === 0) return <button className="button small" onClick={() => void actions.accept(t.id, t.myAssignmentId!)}>Tiếp nhận</button>;
  if (t.myAssignmentId && running && (t.myAssignmentStatus === 1 || t.myAssignmentStatus === 2)) return <button className="button small" onClick={() => actions.open({ kind: 'progress', taskId: t.id, assignmentId: t.myAssignmentId! })}>Cập nhật tiến độ</button>;
  // Không có thao tác cần làm: tên việc đã là liên kết mở chi tiết, không thêm nút "Xem chi tiết" lặp lại.
  return null;
}

function TaskRow({ t, mode }: { t: TaskSummaryDto; mode: Mode }) {
  const reason = reasonOf(t);
  const due = dueInfo(t.myDue || t.due, OPEN.includes(t.status) && t.status !== 3);
  const progress = mode === 'member' ? t.myProgress ?? t.progress : t.progress;
  return (
    <div className={`task-row prio-row-${t.priority}`}>
      <div className="task-row-main">
        <Link className="task-row-title" to={`/cong-viec/chi-tiet?id=${t.id}`}>{t.title}</Link>
        <span className="task-row-meta">
          <Badge map={STATUS} value={t.status} />
          {t.priority >= 3 ? <Prio value={t.priority} /> : null}
          {mode === 'manager' ? <Avatars list={t.assignees} /> : null}
          <span className="muted task-row-unit">{mode === 'member' ? `Giao bởi ${t.creatorName}${t.myRole ? `, ${ROLE[t.myRole]}` : ''}` : t.unitName}</span>
        </span>
      </div>
      <div className="task-row-progress"><Bar value={progress} tone={t.overdue ? 'red' : t.status === 4 ? 'green' : ''} /><span>{pct(progress)}%</span></div>
      <div className="task-row-due">
        {reason ? <span className={`flag flag-${reason[1]}`}>{reason[0]}</span> : null}
        <span className={`due-chip ${due.cls}`}><Glyph name="calendar" size={13} />{due.text.split(', ')[0]}</span>
      </div>
      <div className="task-row-action"><RowAction t={t} /></div>
    </div>
  );
}

const attentionOf = (items: TaskSummaryDto[]) =>
  items.filter((t) => t.status !== 4 && t.status !== 6 && rankOf(t) < 9).sort((a, b) => rankOf(a) - rankOf(b) || dueMs(a) - dueMs(b));
const attentionLimit = (mobile: boolean) => (mobile ? 4 : 6);

function Attention({ items, mode, base }: { items: TaskSummaryDto[]; mode: Mode; base: string }) {
  const mobile = useIsMobile();
  const list = attentionOf(items);
  return (
    <section className="card dash-card">
      <div className="dash-card-head">
        <h3>Việc cần xử lý <span className="count">{list.length}</span></h3>
        <Link className="link-button" to={`${base}&soon=1`}>Xem tất cả <Glyph name="arrow" size={14} /></Link>
      </div>
      {list.length ? <div className="task-rows">{list.slice(0, attentionLimit(mobile)).map((t) => <TaskRow key={t.id} t={t} mode={mode} />)}</div>
        : <div className="dash-empty"><Glyph name="check" size={28} /><strong>Không có việc trễ hay sắp đến hạn</strong><span className="muted small">Mọi công việc đang trong tầm kiểm soát.</span></div>}
    </section>
  );
}

function Upcoming({ items }: { items: TaskSummaryDto[] }) {
  const mobile = useIsMobile();
  const today = todayIso(), end = addDaysIso(today, 14);
  // Việc đang hiện ở "Việc cần xử lý" ngay bên cạnh thì không lặp lại ở đây.
  const shown = new Set(attentionOf(items).slice(0, attentionLimit(mobile)).map((t) => t.id));
  const list = items.filter((t) => !shown.has(t.id) && [1, 2].includes(t.status) && !t.overdue && (t.myDue || t.due) && isoDay(t.myDue || t.due) <= end).sort((a, b) => dueMs(a) - dueMs(b)).slice(0, 7);
  const label = (iso: string) => (iso === today ? 'Hôm nay' : iso === addDaysIso(today, 1) ? 'Ngày mai' : `${toDate(iso + 'T12:00:00Z').toLocaleDateString('vi-VN', { weekday: 'long' })}, ${fmtShort(iso + 'T12:00:00Z')}`);
  let last = '';
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Hạn chót 14 ngày tới</h3><Link className="link-button" to="/cong-viec?view=calendar">Lịch <Glyph name="arrow" size={14} /></Link></div>
      {list.length ? (
        <ol className="deadline-tl">
          {list.map((t) => {
            const day = isoDay(t.myDue || t.due), head = day !== last;
            last = day;
            return (
              <li key={t.id} className={t.dueSoon ? 'soon' : ''}>
                {head ? <span className="tl-date">{label(day)}</span> : null}
                <Link to={`/cong-viec/chi-tiet?id=${t.id}`} className="tl-item"><i aria-hidden="true" /><span><strong>{t.title}</strong><small className="muted">{STATUS[t.status][0]}, {pct(t.progress)}%</small></span></Link>
              </li>
            );
          })}
        </ol>
      ) : <div className="dash-empty"><Glyph name="calendar" size={26} /><span className="muted small">Không có hạn chót nào trong 14 ngày tới.</span></div>}
    </section>
  );
}

// ---------------- 3. Tiến độ & trạng thái ----------------
const STATUS_ORDER: [number, string][] = [[1, '#94a3b8'], [2, '#2563eb'], [3, '#f59e0b'], [5, '#a855f7'], [4, '#16a34a']];

export function StatusCard({ items, base }: { items: TaskSummaryDto[]; base: string }) {
  const total = items.length || 1;
  const done = items.filter((t) => t.status === 4).length;
  const open = items.filter((t) => OPEN.includes(t.status));
  const avg = open.length ? Math.round(open.reduce((s, t) => s + Number(t.progress), 0) / open.length) : 0;
  const counts = STATUS_ORDER.map(([s, c]) => [s, c, items.filter((t) => t.status === s).length] as [number, string, number]);
  const rate = Math.round((100 * done) / total);
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Trạng thái công việc</h3></div>
      <div className="progress-hero">
        <div className="ring" style={{ ['--p' as string]: rate }} role="img" aria-label={`Đã hoàn thành ${rate}%`}><span><b>{rate}%</b><small>hoàn thành</small></span></div>
        <div className="progress-hero-text">
          <strong>{done} / {items.length} công việc đã hoàn thành</strong>
          <span className="muted small">Tiến độ trung bình các việc đang mở</span>
          <span className="progress-cell"><Bar value={avg} /><span className="small"><b>{avg}%</b></span></span>
        </div>
      </div>
      <div className="status-stack" role="img" aria-label={counts.map(([s, , n]) => `${STATUS[s][0]} ${n}`).join(', ')}>
        {counts.filter(([, , n]) => n).map(([s, c, n]) => <i key={s} style={{ flex: n, background: c }} title={`${STATUS[s][0]}: ${n}`} />)}
      </div>
      <ul className="status-legend">
        {counts.map(([s, c, n]) => (
          <li key={s}><Link to={`${base}&status=${s}`}><i style={{ background: c }} />{STATUS[s][0]}<b>{n}</b><span className="muted">{Math.round((100 * n) / total)}%</span></Link></li>
        ))}
      </ul>
    </section>
  );
}

function GroupsCard({ items, base }: { items: TaskSummaryDto[]; base: string }) {
  const groups = new Map<number, { name: string; open: number; overdue: number; done: number; progress: number }>();
  for (const t of items) {
    const g = groups.get(t.unitId) ?? { name: t.unitName, open: 0, overdue: 0, done: 0, progress: 0 };
    if (OPEN.includes(t.status)) { g.open++; g.progress += Number(t.progress); }
    if (t.overdue) g.overdue++;
    if (t.status === 4) g.done++;
    groups.set(t.unitId, g);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].open - a[1].open || b[1].overdue - a[1].overdue).slice(0, 6);
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Theo đơn vị / nhóm</h3><span className="muted small">{groups.size} đơn vị có công việc</span></div>
      {list.length ? (
        <ul className="group-list">
          {list.map(([id, g], i) => {
            const avg = g.open ? Math.round(g.progress / g.open) : 100;
            return (
              <li key={id}>
                <Link to={`${base}&unit=${id}`}>
                  <span className="group-name"><strong>{g.name}</strong>{i === 0 && g.open ? <span className="flag flag-blue">Nhiều việc nhất</span> : null}</span>
                  <span className="group-nums"><b>{g.open}</b> đang mở{g.overdue ? <span className="red">, {g.overdue} quá hạn</span> : null}<span className="muted">, {g.done} xong</span></span>
                  <span className="progress-cell"><Bar value={avg} tone={g.overdue ? 'orange' : ''} /><span className="small">{avg}%</span></span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <Empty title="Chưa có công việc" />}
    </section>
  );
}

// ---------------- 4. Giao việc ----------------
function WorkloadCard({ items, base, canAssign }: { items: TaskSummaryDto[]; base: string; canAssign: boolean }) {
  const open = items.filter((t) => OPEN.includes(t.status));
  const people = new Map<string, { id: number; name: string; initials: string; unit: boolean; open: number; overdue: number; review: number }>();
  for (const t of open) {
    for (const a of t.assignees) {
      const k = `${a.kind}-${a.id}`;
      const p = people.get(k) ?? { id: a.id, name: a.name, initials: a.initials, unit: a.kind === 'unit', open: 0, overdue: 0, review: 0 };
      p.open++;
      if (t.overdue) p.overdue++;
      if (a.status === 3) p.review++;
      people.set(k, p);
    }
  }
  const list = [...people.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue).slice(0, 8);
  const max = Math.max(1, ...list.map((p) => p.open));
  const unassigned = open.filter((t) => !t.assignees.length && t.status !== 5);
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Khối lượng việc theo người thực hiện</h3><span className="muted small">{people.size} người / đơn vị đang nhận việc</span></div>
      {unassigned.length && canAssign ? (
        <div className="assign-callout">
          <Glyph name="assign" size={20} />
          <span><strong>{unassigned.length} công việc chưa giao người thực hiện</strong><small className="muted">{unassigned.slice(0, 2).map((t) => t.title).join('; ')}{unassigned.length > 2 ? '…' : ''}</small></span>
          <Link className="button small" to={`/cong-viec/chi-tiet?id=${unassigned[0].id}&tab=assign`}>Giao việc</Link>
        </div>
      ) : null}
      {list.length ? (
        <ul className="workload">
          {list.map((p) => (
            <li key={`${p.unit}-${p.id}`}>
              <Avatar initials={p.initials} tone={p.id} />
              <span className="workload-name"><strong>{p.name}</strong>{p.unit || p.review ? <small className="muted">{[p.unit ? 'Đơn vị nhận việc' : '', p.review ? `${p.review} chờ duyệt` : ''].filter(Boolean).join(', ')}</small> : null}</span>
              <span className="workload-bar"><span className="bar"><b style={{ width: `${(100 * p.open) / max}%` }} /></span></span>
              <span className="workload-num"><b>{p.open}</b> việc{p.overdue ? <span className="flag flag-red">{p.overdue} trễ</span> : null}</span>
            </li>
          ))}
        </ul>
      ) : <Empty title="Chưa có phân công đang mở" description="Giao việc cho cá nhân hoặc đơn vị để theo dõi khối lượng tại đây." />}
      <Link className="dash-more" to={base}>Xem toàn bộ phân công <Glyph name="arrow" size={14} /></Link>
    </section>
  );
}

function MyAssignmentCard({ items }: { items: TaskSummaryDto[] }) {
  const open = items.filter((t) => OPEN.includes(t.status));
  const lead = open.filter((t) => t.myRole === 1).length, support = open.filter((t) => t.myRole === 2).length;
  const byCreator = new Map<string, number>();
  open.forEach((t) => byCreator.set(t.creatorName, (byCreator.get(t.creatorName) ?? 0) + 1));
  const creators = [...byCreator.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const waiting = open.filter((t) => t.myAssignmentStatus === 0).length, submitted = open.filter((t) => t.myAssignmentStatus === 3).length;
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Phân công của tôi</h3><span className="muted small">{open.length} việc đang mở</span></div>
      <div className="mini-stats">
        <div><b>{lead}</b><small>Chủ trì</small></div>
        <div><b>{support}</b><small>Phối hợp</small></div>
        <div><b className={waiting ? 'blue' : ''}>{waiting}</b><small>Chờ tiếp nhận</small></div>
        <div><b className={submitted ? 'orange' : ''}>{submitted}</b><small>Đã nộp, chờ duyệt</small></div>
      </div>
      {creators.length ? (
        <ul className="workload compact">
          {creators.map(([name, n], i) => (
            <li key={name}><Avatar initials={name.split(' ').slice(-2).map((x) => x[0]).join('')} tone={i} /><span className="workload-name"><strong>{name}</strong><small className="muted">Người tạo việc</small></span><span className="workload-num"><b>{n}</b> việc</span></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ---------------- 5. Thống kê & đánh giá ----------------
export function EvaluationCard() {
  const p = periodOf(new URLSearchParams());
  const q = useQuery({
    queryKey: ['stats', 'unit', p.from, p.to, '', ''],
    queryFn: () => get<UnitStatsDto>(`/api/thong-ke/don-vi?from=${p.from}&to=${p.to}`),
    staleTime: 30_000,
  });
  const s = q.data;
  if (!s) return <section className="card dash-card">{q.error ? <p className="muted">{(q.error as Error).message}</p> : <Loading title="Đang tính thống kê…" />}</section>;
  const reviewed = s.passed + s.needsWork + s.failed;
  const top = [...s.byPerson].filter((x) => x.completed).sort((a, b) => b.completed - a.completed || b.onTimePercent - a.onTimePercent).slice(0, 4);
  return (
    <section className="card dash-card eval-card">
      <div className="dash-card-head"><h3>Hiệu quả thực hiện</h3><span className="muted small">{p.presets[p.preset as 'year']?.[2] ?? 'Kỳ hiện tại'}, {s.scopeLabel}</span></div>
      <div className="eval-grid">
        <div className="eval-block">
          <div className="progress-hero">
            <div className="ring green" style={{ ['--p' as string]: s.completed ? s.onTimePercent : 0 }}><span><b>{s.completed ? `${s.onTimePercent}%` : '—'}</b><small>đúng hạn</small></span></div>
            <div className="progress-hero-text">
              <strong>{s.onTimeCount} / {s.completed} việc xong đúng hạn</strong>
              <span className="muted small">{s.total} công việc trong kỳ, {s.open} đang mở</span>
              {s.overdue ? <span className="flag flag-red">{s.overdue} đang quá hạn</span> : <span className="flag flag-green">Không có việc quá hạn</span>}
            </div>
          </div>
        </div>
        <div className="eval-block">
          <h4>Kết quả đánh giá <span className="muted small">{reviewed} lượt duyệt</span></h4>
          <div className="status-stack">
            {s.passed ? <i style={{ flex: s.passed, background: '#16a34a' }} title={`Đạt: ${s.passed}`} /> : null}
            {s.needsWork ? <i style={{ flex: s.needsWork, background: '#f59e0b' }} title={`Cần bổ sung: ${s.needsWork}`} /> : null}
            {s.failed ? <i style={{ flex: s.failed, background: '#dc2626' }} title={`Không đạt: ${s.failed}`} /> : null}
          </div>
          <ul className="status-legend inline">
            <li><span><i style={{ background: '#16a34a' }} />Đạt<b>{s.passed}</b></span></li>
            <li><span><i style={{ background: '#f59e0b' }} />Cần bổ sung<b>{s.needsWork}</b></span></li>
            <li><span><i style={{ background: '#dc2626' }} />Không đạt<b>{s.failed}</b></span></li>
          </ul>
        </div>
        <div className="eval-block">
          <h4>Hoàn thành nhiều nhất</h4>
          {top.length ? (
            <ul className="workload compact">
              {top.map((x, i) => (
                <li key={x.personId}><span className="rank">{i + 1}</span><Avatar initials={x.initials} tone={x.personId} /><span className="workload-name"><strong>{x.name}</strong><small className="muted">{x.unitName}</small></span><span className="workload-num stacked"><span><b>{x.completed}</b> xong</span><small>{x.onTimePercent}% đúng hạn</small></span></li>
              ))}
            </ul>
          ) : <p className="muted small">Chưa có việc hoàn thành trong kỳ.</p>}
        </div>
      </div>
      <Link className="dash-more" to="/thong-ke">Xem thống kê đầy đủ <Glyph name="arrow" size={14} /></Link>
    </section>
  );
}

// ---------------- Bảng điều khiển ----------------
/**
 * Khu vực phân tích (3–5) trên điện thoại: thu gọn mặc định để "Cần chú ý" nằm trong tầm nhìn;
 * bấm tiêu đề để mở. Trạng thái mở/đóng ghi nhớ trên trình duyệt này. Máy tính luôn mở.
 */
const FOLD_KEY = 'khoa.dashFold';
function readFold(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { return {}; } }
function Fold({ id, mobile, head, children }: { id: string; mobile: boolean; head: { title: string; sub?: string; action?: ReactNode }; children: ReactNode }) {
  const [open, setOpen] = useState(() => readFold()[id] === true);
  if (!mobile) return <section className="dash-section"><SectionHead {...head} />{children}</section>;
  const toggle = () => {
    const next = !open; setOpen(next);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFold(), [id]: next })); } catch { /* trình duyệt chặn lưu trữ: bỏ qua */ }
  };
  return (
    <section className={`dash-section dash-fold ${open ? 'open' : ''}`}>
      <button type="button" className="dash-fold-head" aria-expanded={open} aria-controls={`fold-${id}`} onClick={toggle}>
        <span className="dash-fold-text"><b>{head.title}</b>{head.sub ? <small>{head.sub}</small> : null}</span>
        <Glyph name="chevronDown" size={20} className="dash-fold-caret" />
      </button>
      {open ? <div id={`fold-${id}`} className="dash-fold-body">{children}</div> : null}
    </section>
  );
}

export function Dashboard({ mode, evaluation }: { mode: Mode; evaluation?: ReactNode }) {
  const access = useAccess();
  const scope = mode === 'member' ? 'assigned' : access.isAdmin || access.viewUnitIds.length ? 'all' : 'created';
  const list = useTaskList(scope);
  const base = `/cong-viec?scope=${scope}`;
  const mobile = useIsMobile();
  if (!list.data) return list.error ? <div className="card card-pad" role="alert"><p>{(list.error as Error).message}</p></div> : <Loading title="Đang tải công việc…" />;
  const items = list.data.items.filter((t) => t.status !== 0 && t.status !== 6);
  const scopeText = scope === 'all' ? 'Toàn bộ công việc trong phạm vi bạn quản lý' : scope === 'created' ? 'Công việc bạn đã tạo hoặc giao' : 'Công việc được giao cho bạn';
  return (
    <div className="dash">
      <section className="dash-section">
        <SectionHead title="Tổng quan công việc" sub={mobile ? undefined : scopeText} />
        <Overview items={items} base={base} />
      </section>
      <section className="dash-section">
        {/* Điện thoại: thẻ bên dưới đã có tiêu đề "Việc cần xử lý" — bỏ tiêu đề mục để không lặp. */}
        {mobile ? null : <SectionHead title="Cần chú ý" />}
        <div className="dash-grid wide-left"><Attention items={items} mode={mode} base={base} /><Upcoming items={items} /></div>
      </section>
      <Fold id="progress" mobile={mobile} head={{ title: 'Tiến độ & trạng thái' }}>
        <div className="dash-grid two"><StatusCard items={items} base={base} /><GroupsCard items={items} base={base} /></div>
      </Fold>
      <Fold id="assign" mobile={mobile} head={{ title: mode === 'manager' ? 'Giao việc' : 'Vai trò của tôi',
        action: mode === 'manager' && access.canCreate ? <Link className="button small secondary m-hide" to="/cong-viec/tao"><Glyph name="plus" size={15} />Tạo và giao việc</Link> : undefined }}>
        {mode === 'manager' ? <WorkloadCard items={items} base={base} canAssign={access.canAssignAny} /> : <MyAssignmentCard items={items} />}
      </Fold>
      <Fold id="eval" mobile={mobile} head={{ title: 'Thống kê & đánh giá' }}>
        {mode === 'manager' && access.canViewUnitStats ? <EvaluationCard /> : evaluation}
      </Fold>
    </div>
  );
}
