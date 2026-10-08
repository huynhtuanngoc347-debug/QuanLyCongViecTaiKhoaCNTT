import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { TaskSummaryDto } from '@khoa/shared';
import { useAccess } from '../nav';
import { Avatars, Badge, Bar, ButtonLink, Empty, Loading, Options, PRIORITY, PageHeader, Prio, STATUS, SegLinks } from '../ui/ui';
import { dueInfo, isoDay, normalize, pct, todayIso } from '../format';
import { useTitle } from '../pages/common';
import { hashOf, useCategories, useTaskList } from './queries';
import { useTaskActions } from './dialogs';

interface Filters { scope: string; view: string; status: string; cat: string; prio: string; unit: string; overdue: boolean; soon: boolean; q: string; month: string; }

function filtersOf(p: URLSearchParams, fixedScope?: string, defaultScope = 'assigned'): Filters {
  return {
    scope: fixedScope || p.get('scope') || defaultScope, view: p.get('view') || 'table', status: p.get('status') || '', cat: p.get('cat') || '',
    prio: p.get('prio') || '', unit: p.get('unit') || '', overdue: p.get('overdue') === '1', soon: p.get('soon') === '1', q: p.get('q') || '',
    month: p.get('month') || todayIso().slice(0, 7),
  };
}

function filterItems(items: TaskSummaryDto[], f: Filters): TaskSummaryDto[] {
  const q = normalize(f.q);
  return items.filter((t) => (!f.status || String(t.status) === f.status) && (!f.cat || String(t.categoryId) === f.cat)
    && (!f.prio || String(t.priority) === f.prio) && (!f.unit || String(t.unitId) === f.unit)
    && (!f.overdue || t.overdue) && (!f.soon || t.dueSoon || t.overdue)
    && (f.status === '6' || t.status !== 6)
    && (!q || normalize(`${t.title} ${t.unitName} ${t.categoryName} ${t.assignees.map((a) => a.name).join(' ')}`).includes(q)));
}

const toneFor = (t: TaskSummaryDto) => (t.status === 4 ? 'green' : t.overdue ? 'orange' : '');
const EMPTY_TITLE: Record<string, string> = { assigned: 'Bạn chưa được giao việc nào', created: 'Bạn chưa tạo hoặc giao việc nào', all: 'Chưa có công việc trong phạm vi', review: 'Không có gì chờ bạn duyệt' };

function QuickActions({ t }: { t: TaskSummaryDto }) {
  const actions = useTaskActions();
  if (!t.myAssignmentId || ![1, 2].includes(t.status)) return null;
  if (t.myAssignmentStatus === 0) return <button className="button small" onClick={() => void actions.accept(t.id, t.myAssignmentId!)}>Tiếp nhận</button>;
  if (t.myAssignmentStatus === 1 || t.myAssignmentStatus === 2) return <button className="button small" onClick={() => actions.open({ kind: 'progress', taskId: t.id, assignmentId: t.myAssignmentId! })}>Cập nhật</button>;
  return null;
}

function Table({ shown, total }: { shown: TaskSummaryDto[]; total: number }) {
  return (
    <div className="card table-card">
      <div className="table-wrap">
        <table className="task-table">
          <thead><tr><th scope="col">Công việc</th><th scope="col">Trạng thái</th><th scope="col">Tiến độ</th><th scope="col">Ưu tiên</th><th scope="col">Hạn</th><th scope="col">Người nhận</th><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>
            {shown.map((t) => {
              const open = [1, 2, 3, 5].includes(t.status), due = dueInfo(t.myDue || t.due, open && t.status !== 3);
              return (
                <tr key={t.id} className={t.overdue ? 'is-late' : ''}>
                  <td><Link className="task-title" to={`/cong-viec/chi-tiet?id=${t.id}`}>{t.title}</Link><small className="muted">{t.categoryName || 'Chưa có thể loại'} · {t.unitName}</small>{t.pendingReviews ? <span className="pill-alert">{t.pendingReviews} việc chờ bạn xử lý</span> : null}</td>
                  <td><Badge map={STATUS} value={t.status} /></td>
                  <td><div className="progress-cell"><Bar value={t.progress} tone={toneFor(t)} /><span className="muted small">{pct(t.progress)}%</span></div></td>
                  <td><Prio value={t.priority} /></td>
                  <td><span className={`due ${due.cls}`}>{due.text}</span></td>
                  <td><Avatars list={t.assignees} /></td>
                  <td className="row-actions"><QuickActions t={t} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><span>Hiển thị {shown.length} / {total} công việc</span></div>
    </div>
  );
}

/** Danh sách dạng thẻ cho điện thoại: nhóm theo tình trạng, mỗi dòng có vòng tiến độ. */
const M_GROUPS: [string, string, (t: TaskSummaryDto) => boolean][] = [
  ['late', 'Quá hạn', (t) => t.overdue && [1, 2, 5].includes(t.status)],
  ['review', 'Chờ duyệt', (t) => t.status === 3],
  ['doing', 'Đang thực hiện', (t) => t.status === 2 || t.status === 5],
  ['new', 'Chưa bắt đầu', (t) => t.status === 1 || t.status === 0],
  ['done', 'Hoàn thành', (t) => t.status === 4],
  ['cancel', 'Đã hủy', (t) => t.status === 6],
];

function MobileList({ items }: { items: TaskSummaryDto[] }) {
  const seen = new Set<number>();
  return (
    <div className="m-tasks">
      {M_GROUPS.map(([key, label, test]) => {
        const list = items.filter((t) => !seen.has(t.id) && test(t));
        list.forEach((t) => seen.add(t.id));
        if (!list.length) return null;
        return (
          <section key={key} className={`m-group g-${key}`} aria-label={label}>
            <h2 className="m-group-head"><b>{label}</b><span>{list.length} việc</span></h2>
            <div className="m-group-list">
              {list.map((t) => {
                const open = [1, 2, 3, 5].includes(t.status), due = dueInfo(t.myDue || t.due, open && t.status !== 3), p = pct(t.progress);
                return (
                  <Link key={t.id} className={`m-task ${t.pendingReviews ? 'needs-me' : ''}`} to={`/cong-viec/chi-tiet?id=${t.id}`}>
                    <span className="m-ring" style={{ '--p': `${Math.min(100, p)}%` } as React.CSSProperties}><span>{t.status === 4 ? '✓' : `${p}%`}</span></span>
                    <span className="m-task-main">
                      <strong>{t.title}</strong>
                      <span className="m-task-meta">
                        <Badge map={STATUS} value={t.status} />
                        {t.priority >= 3 ? <Prio value={t.priority} /> : null}
                        {due.text ? <span className={`due ${due.cls}`}>{due.text}</span> : null}
                      </span>
                      {t.pendingReviews ? <span className="pill-alert">{t.pendingReviews} việc chờ bạn xử lý</span> : null}
                    </span>
                    <Avatars list={t.assignees.slice(0, 2)} />
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Kanban({ items }: { items: TaskSummaryDto[] }) {
  const cols: [number, string, (t: TaskSummaryDto) => boolean][] = [
    [1, 'Chưa bắt đầu', (t) => t.status === 1 || t.status === 0], [2, 'Đang thực hiện', (t) => t.status === 2 || t.status === 5],
    [3, 'Chờ duyệt', (t) => t.status === 3], [4, 'Hoàn thành', (t) => t.status === 4],
  ];
  return (
    <div className="kanban">
      {cols.map(([s, l, test]) => {
        const list = items.filter(test);
        return (
          <section key={s} className="kanban-col" aria-label={l}>
            <header><Badge map={STATUS} value={s} /><span className="muted">{list.length}</span></header>
            {list.length ? list.map((t) => {
              const due = dueInfo(t.due, [1, 2].includes(t.status));
              return (
                <Link key={t.id} className="kanban-card card" to={`/cong-viec/chi-tiet?id=${t.id}`}>
                  <small className="muted">{t.categoryName || 'Chưa phân loại'}{t.status === 5 ? ' · tạm dừng' : t.status === 0 ? ' · nháp' : ''}</small>
                  <strong>{t.title}</strong>
                  <span className="progress-cell"><Bar value={t.progress} tone={toneFor(t)} /><span className="muted small">{pct(t.progress)}%</span></span>
                  <span className="kanban-foot"><span className={`due ${due.cls}`}>{due.text}</span><Avatars list={t.assignees} /></span>
                </Link>
              );
            }) : <p className="muted small kanban-empty">Không có việc</p>}
          </section>
        );
      })}
    </div>
  );
}

function Calendar({ items, f, link }: { items: TaskSummaryDto[]; f: Filters; link: (c: Partial<Record<keyof Filters, string | boolean>>) => string }) {
  const [y, m] = f.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), startDow = (first.getUTCDay() + 6) % 7;
  const start = new Date(first); start.setUTCDate(1 - startDow);
  const weeks = Math.ceil((startDow + new Date(Date.UTC(y, m, 0)).getUTCDate()) / 7);
  const byDay: Record<string, TaskSummaryDto[]> = {};
  items.filter((t) => t.due).forEach((t) => { (byDay[isoDay(t.due)] ||= []).push(t); });
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`, next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const today = todayIso();
  const cells: React.ReactNode[] = [];
  for (let w = 0; w < weeks; w++) {
    const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + w * 7 + i); return d.toISOString().slice(0, 10); });
    const n = days.reduce((s, d) => s + (byDay[d]?.length || 0), 0), heavy = n >= 5;
    cells.push(<div key={`w${w}`} className={`cal-week ${heavy ? 'heavy' : ''}`}><span className="muted small">Tuần</span><strong>{n} hạn</strong></div>);
    days.forEach((d) => {
      const out = Number(d.slice(5, 7)) !== m, list = byDay[d] || [];
      cells.push(
        <div key={d} className={`cal-day ${out ? 'out' : ''} ${heavy ? 'heavy' : ''} ${d === today ? 'today' : ''}`}>
          <span className="cal-num">{Number(d.slice(8))}{out ? '/' + Number(d.slice(5, 7)) : ''}</span>
          {list.slice(0, 3).map((t) => <Link key={t.id} className={`cal-pill st-${t.overdue ? 'cancel' : t.dueSoon ? 'review' : STATUS[t.status][1]}`} to={`/cong-viec/chi-tiet?id=${t.id}`} title={t.title}>{t.title}</Link>)}
          {list.length > 3 ? <span className="muted small">+{list.length - 3} việc</span> : null}
        </div>,
      );
    });
  }
  return (
    <>
      <div className="card calendar">
        <div className="cal-head">
          <Link className="button secondary small" to={link({ view: 'calendar', month: prev })} aria-label="Tháng trước">‹</Link>
          <h2>Tháng {m}, {y}</h2>
          <Link className="button secondary small" to={link({ view: 'calendar', month: next })} aria-label="Tháng sau">›</Link>
          <Link className="button secondary small" to={link({ view: 'calendar', month: today.slice(0, 7) })}>Hôm nay</Link>
          <span className="cal-legend"><i className="st-cancel" />Quá hạn <i className="st-review" />Sắp đến hạn <i className="st-doing" />Đang làm <i className="st-done" />Hoàn thành</span>
        </div>
        <div className="cal-grid"><div />{['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'].map((d) => <div key={d} className="cal-dow">{d}</div>)}{cells}</div>
      </div>
      <p className="muted small">Công việc hiện theo ngày hạn. Tuần có từ 5 hạn trở lên được tô cam để dễ thấy tuần dồn việc.</p>
    </>
  );
}

/** Danh sách công việc theo nhóm; fixedScope="review" là trang "Chờ tôi duyệt". */
export function TaskListPage({ fixedScope }: { fixedScope?: string }) {
  const access = useAccess();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // Quản trị hệ thống không thuộc đơn vị nào thì không có "việc được giao": mặc định xem tất cả (chỉ đọc).
  const f = filtersOf(params, fixedScope, access.caps.isMember ? 'assigned' : 'all');
  const list = useTaskList(f.scope);
  const cats = useCategories().data ?? [];
  const [search, setSearch] = useState(f.q);
  useTitle(fixedScope ? 'Chờ tôi duyệt' : 'Công việc');
  const base = fixedScope ? '/cho-duyet' : '/cong-viec';
  const link = (changes: Partial<Record<keyof Filters, string | boolean>>) => {
    const view = (changes.view as string | undefined) ?? f.view;
    return hashOf(base, { ...f, ...changes, scope: fixedScope ? '' : ((changes.scope as string | undefined) ?? f.scope), view: view === 'table' ? '' : view, month: view === 'calendar' ? ((changes.month as string | undefined) ?? f.month) : '' });
  };
  // Tìm kiếm: cập nhật địa chỉ sau 180 ms (không tải lại dữ liệu).
  useEffect(() => {
    if (search === f.q) return;
    const t = window.setTimeout(() => navigate(link({ q: search }), { replace: true }), 180);
    return () => window.clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = list.data?.counts;
  const scopes: [string, string, boolean][] = [
    ['assigned', 'Tôi được giao', access.caps.isMember],
    ['created', 'Tôi đã tạo / giao', access.canAssignAny || (counts?.created ?? 0) > 0],
    ['all', access.isAdmin ? 'Tất cả (chỉ đọc)' : 'Tất cả trong phạm vi', access.isAdmin || access.viewUnitIds.length > 0],
    ['review', 'Chờ tôi duyệt', access.canReviewAny || (counts?.review ?? 0) > 0],
  ];
  const unitOptions = useMemo(() => [...new Map((list.data?.items ?? []).map((t) => [t.unitId, t.unitName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi')), [list.data]);
  const setFilter = (key: keyof Filters, value: string) => navigate(link({ [key]: value }), { replace: true });

  let body: React.ReactNode;
  if (!list.data && list.error) body = <div className="card card-pad stack" role="alert"><h2>Không tải được dữ liệu</h2><p className="muted">{(list.error as Error).message}</p><div className="actions"><button className="button secondary" onClick={() => void list.refetch()}>Thử lại</button></div></div>;
  else if (!list.data) body = <Loading title="Đang tải danh sách công việc…" />;
  else {
    const items = list.data.items, shown = filterItems(items, f);
    body = (
      <div id="task-results">
        {shown.length ? <div className="m-only"><MobileList items={shown} /></div> : null}
        <div className={shown.length ? 'd-only' : ''}>
        {f.view === 'kanban' ? <Kanban items={shown} /> : f.view === 'calendar' ? <Calendar items={shown} f={f} link={link} />
          : shown.length ? <Table shown={shown} total={items.length} />
            : <div className="card"><Empty title={items.length ? 'Không có công việc phù hợp bộ lọc' : EMPTY_TITLE[f.scope] ?? 'Chưa có công việc'}
              description={items.length ? 'Bỏ bớt điều kiện lọc để xem thêm.' : ({ assigned: 'Khi có người giao việc, việc sẽ hiện ở đây và trong chuông thông báo.', created: access.canCreate ? 'Bấm “Tạo công việc” để bắt đầu.' : 'Chức vụ của bạn chưa có quyền tạo công việc.', all: 'Đơn vị trong phạm vi của bạn chưa có công việc.', review: 'Kết quả nộp lên và yêu cầu gia hạn sẽ hiện ở đây.' } as Record<string, string>)[f.scope]}
              action={items.length ? <Link className="button secondary" to={hashOf(f.scope === 'review' ? '/cho-duyet' : '/cong-viec', { scope: f.scope === 'review' ? '' : f.scope })}>Bỏ lọc</Link> : undefined} /></div>}
        </div>
      </div>
    );
  }
  return (
    <>
      {fixedScope
        ? <PageHeader title="Chờ tôi duyệt" description="Kết quả cần đánh giá, yêu cầu gia hạn và việc giao cho đơn vị chưa tiếp nhận." />
        : <PageHeader title="Công việc" description={access.isAdmin && !access.caps.isMember ? 'Bạn đang xem ở chế độ chỉ đọc (quản trị hệ thống).' : 'Việc được giao cho bạn và việc bạn quản lý.'} action={access.canCreate ? <ButtonLink to="/cong-viec/tao">+ Tạo công việc</ButtonLink> : undefined} />}
      <div className="task-toolbar">
        {fixedScope ? null : (
          <div className="chips" role="navigation" aria-label="Nhóm công việc">
            {scopes.filter((s) => s[2]).map(([k, l]) => (
              <Link key={k} className={`chip ${f.scope === k ? 'on' : ''}`} to={link({ scope: k })} aria-current={f.scope === k ? 'page' : undefined}>
                {l}{counts?.[k as keyof typeof counts] !== undefined ? <> <span className="chip-count">{counts[k as keyof typeof counts]}</span></> : null}
              </Link>
            ))}
          </div>
        )}
        <SegLinks label="Kiểu xem" value={f.view} items={[['table', 'Bảng', link({ view: 'table' })], ['kanban', 'Kanban', link({ view: 'kanban' })], ['calendar', 'Lịch', link({ view: 'calendar' })]]} />
      </div>
      <div className="task-filters" role="search">
        <label className="search-box"><span className="sr-only">Tìm công việc</span><input id="task-search" type="search" placeholder="Tìm theo tiêu đề, đơn vị, người nhận…" value={search} autoComplete="off" onChange={(e) => setSearch(e.target.value)} /></label>
        <select id="filter-status" aria-label="Trạng thái" value={f.status} onChange={(e) => setFilter('status', e.target.value)}><Options items={Object.entries(STATUS).filter(([k]) => k !== '0' || f.scope === 'created').map(([k, [l]]) => [k, l])} placeholder="Mọi trạng thái" /></select>
        <select id="filter-cat" aria-label="Thể loại" value={f.cat} onChange={(e) => setFilter('cat', e.target.value)}><Options items={cats.map((c) => [c.id, c.name])} placeholder="Mọi thể loại" /></select>
        <select id="filter-prio" aria-label="Ưu tiên" value={f.prio} onChange={(e) => setFilter('prio', e.target.value)}><Options items={Object.entries(PRIORITY).map(([k, [l]]) => [k, l] as [string, string]).reverse()} placeholder="Mọi mức ưu tiên" /></select>
        {unitOptions.length > 1 ? <select id="filter-unit" aria-label="Đơn vị" value={f.unit} onChange={(e) => setFilter('unit', e.target.value)}><Options items={unitOptions} placeholder="Mọi đơn vị" /></select> : null}
        <Link className={`chip ${f.overdue ? 'on' : ''}`} data-tone="danger" to={link({ overdue: !f.overdue, soon: false })}>Quá hạn</Link>
        <Link className={`chip ${f.soon ? 'on' : ''}`} to={link({ soon: !f.soon, overdue: false })}>Sắp đến hạn</Link>
      </div>
      {body}
    </>
  );
}
