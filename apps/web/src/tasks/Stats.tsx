import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { CountItemDto, MonthItemDto, PersonalStatsDto, UnitStatsDto } from '@khoa/shared';
import { get } from '../api/client';
import { useSession } from '../session';
import { useAccess } from '../nav';
import { Avatar, Bar, ButtonLink, Empty, Kpi, Loading, Options, SegLinks } from '../ui/ui';
import { fmtDay, ymdText } from '../format';
import { useTitle } from '../pages/common';
import { hashOf, useCategories } from './queries';
import { periodOf } from './period';
import { Failed } from './TaskDetail';

function PeriodBar({ path, extra }: { path: string; extra: Record<string, string> }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const p = periodOf(params);
  const [from, setFrom] = useState(p.from), [to, setTo] = useState(p.to);
  // Đổi kỳ (Tháng này / Học kỳ / Năm học / Tùy chọn) thì hai ô ngày lấy lại giá trị của kỳ đang xem.
  useEffect(() => { setFrom(p.from); setTo(p.to); }, [p.from, p.to]);
  const invalid = !from || !to ? 'Chọn đủ ngày bắt đầu và ngày kết thúc.' : to < from ? 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' : '';
  const apply = (e: React.FormEvent) => { e.preventDefault(); if (!invalid) navigate(hashOf(path, { ...extra, period: 'custom', from, to })); };
  const items: [string, string, string][] = [
    ...(Object.entries(p.presets) as [string, [string, string, string]][]).map(([k, [, , l]]) => [k, l, hashOf(path, { ...extra, period: k })] as [string, string, string]),
    ['custom', 'Tùy chọn…', hashOf(path, { ...extra, period: 'custom', from: p.from, to: p.to })],
  ];
  return (
    <div className="period-bar">
      <SegLinks label="Kỳ thống kê" value={p.preset} items={items} />
      {p.preset === 'custom' ? (
        <form className="custom-range" onSubmit={apply} noValidate>
          <label>Từ <input type="date" id="stat-from" value={from} max={to || undefined} aria-invalid={invalid ? true : undefined}
            onChange={(e) => { const v = e.target.value; setFrom(v); if (v && to && v > to) setTo(v); }} /></label>
          <label>đến <input type="date" id="stat-to" value={to} min={from || undefined} aria-invalid={invalid ? true : undefined}
            onChange={(e) => setTo(e.target.value)} /></label>
          <button type="submit" className="button small secondary" disabled={!!invalid || (from === p.from && to === p.to)}>Xem</button>
          {invalid ? <span className="error-text small" role="alert">{invalid}</span> : null}
        </form>
      ) : null}
    </div>
  );
}

const COLORS: Record<string, string> = { done: '#34c759', doing: '#0071e3', review: '#ff9500', new: '#aeaeb2', paused: '#af52de' };
function Donut({ items }: { items: CountItemDto[] }) {
  const total = items.reduce((s, x) => s + x.value, 0) || 1, R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = items.filter((x) => x.value).map((x) => {
    const L = (C * x.value) / total;
    const el = <circle key={x.key} cx="70" cy="70" r={R} fill="none" stroke={COLORS[x.key] ?? '#8e8e93'} strokeWidth="18" strokeDasharray={`${Math.max(0, L - 2).toFixed(2)} ${(C - L + 2).toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)} transform="rotate(-90 70 70)" />;
    off += L;
    return el;
  });
  const done = items.find((x) => x.key === 'done')?.value ?? 0;
  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Biểu đồ trạng thái">{arcs.length ? arcs : <circle cx="70" cy="70" r={R} fill="none" stroke="#e8e8ed" strokeWidth="18" />}</svg>
        <span><b>{Math.round((100 * done) / total)}%</b><small className="muted">hoàn thành</small></span>
      </div>
      <ul className="legend">{items.map((x) => <li key={x.key}><i style={{ background: COLORS[x.key] ?? '#8e8e93' }} /><span>{x.label}</span><b>{x.value}</b><span className="muted small">{Math.round((100 * x.value) / total)}%</span></li>)}</ul>
    </div>
  );
}

function MonthBars({ months, labels = ['Được giao', 'Hoàn thành'] }: { months: MonthItemDto[]; labels?: [string, string] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.assigned, m.completed]));
  return (
    <>
      <div className="bars-legend"><span><i className="light" />{labels[0]}</span><span><i />{labels[1]}</span></div>
      <div className="bars">
        {months.map((m) => (
          <div key={m.month} className="bar-col">
            <div className="bar-pair">
              <span className="b light" style={{ height: `${((100 * m.assigned) / max).toFixed(1)}%` }} title={`${labels[0]}: ${m.assigned}`}><em>{m.assigned}</em></span>
              <span className="b" style={{ height: `${((100 * m.completed) / max).toFixed(1)}%` }} title={`${labels[1]}: ${m.completed}`}><em>{m.completed}</em></span>
            </div>
            <small className="muted">T{Number(m.month.slice(5))}</small>
          </div>
        ))}
      </div>
    </>
  );
}

function exportCsv(s: UnitStatsDto) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: unknown[][] = [
    ['Thống kê công việc', s.scopeLabel], ['Kỳ', `${s.from} đến ${s.to}`], [], ['Tổng', s.total], ['Hoàn thành', s.completed], ['Đúng hạn (%)', s.onTimePercent],
    ['Đang quá hạn', s.overdue], ['Đạt', s.passed], ['Cần bổ sung', s.needsWork], ['Không đạt', s.failed], [],
    ['Đơn vị', 'Tổng', 'Đang mở', 'Hoàn thành', 'Quá hạn', 'Đúng hạn (%)'], ...s.byUnit.map((u) => [u.unitName, u.total, u.open, u.completed, u.overdue, u.onTimePercent]), [],
    ['Người thực hiện', 'Đơn vị', 'Được giao', 'Hoàn thành', 'Đúng hạn (%)', 'Quá hạn', 'Đạt'], ...s.byPerson.map((x) => [x.name, x.unitName, x.assigned, x.completed, x.onTimePercent, x.overdue, x.passed]),
  ];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `thong-ke-cong-viec-${s.from}-${s.to}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function UnitStatsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { org } = useSession();
  const access = useAccess();
  const cats = useCategories().data ?? [];
  const p = periodOf(params), unit = params.get('unit') ?? '', cat = params.get('cat') ?? '';
  const q = useQuery({
    queryKey: ['stats', 'unit', p.from, p.to, unit, cat],
    queryFn: () => get<UnitStatsDto>(`/api/thong-ke/don-vi?from=${p.from}&to=${p.to}${unit ? '&unitId=' + unit : ''}${cat ? '&categoryId=' + cat : ''}`),
    staleTime: 30_000,
  });
  useTitle('Thống kê đơn vị');
  const unitName = (id: number) => org.units.find((u) => u.id === id)?.name ?? `Đơn vị ${id}`;
  const scopeUnits = (access.isAdmin ? org.units.map((u) => u.id) : access.viewUnitIds).map((id) => [id, unitName(id)] as [number, string]).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const setParam = (k: string, v: string) => navigate(hashOf('/thong-ke', { ...Object.fromEntries(params.entries()), [k]: v }), { replace: true });
  const s = q.data;
  const listLink = (extra: Record<string, string | number>) => hashOf('/cong-viec', { scope: 'all', ...extra });
  return (
    <>
      <div className="detail-title stats-head">
        <div><h1 tabIndex={-1} id="page-title">Thống kê công việc</h1><p className="muted">{s?.scopeLabel ?? 'Trong phạm vi bạn được xem'} · {ymdText(p.from)} – {ymdText(p.to)}</p><p className="muted small stats-note">Tính các công việc còn hoạt động trong kỳ (tạo trước ngày kết thúc, chưa xong trước ngày bắt đầu); lượt đánh giá tính theo ngày duyệt trong kỳ.</p></div>
        <div className="actions">
          {access.caps.isMember ? <SegLinks label="Phạm vi" value="unit" items={[['unit', 'Đơn vị', '/thong-ke'], ['me', 'Của tôi', '/thong-ke-ca-nhan']]} /> : null}
          {s ? <button className="button secondary m-hide" onClick={() => exportCsv(s)}>Xuất CSV (Excel)</button> : null}
        </div>
      </div>
      <div className="task-filters">
        <PeriodBar path="/thong-ke" extra={{ unit, cat }} />
        <select id="stat-unit" aria-label="Đơn vị" value={unit} onChange={(e) => setParam('unit', e.target.value)}><Options items={scopeUnits} placeholder="Mọi đơn vị trong phạm vi" /></select>
        <select id="stat-cat" aria-label="Thể loại" value={cat} onChange={(e) => setParam('cat', e.target.value)}><Options items={cats.map((c) => [c.id, c.name])} placeholder="Mọi thể loại" /></select>
      </div>
      {!s ? (q.error ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : <Loading title="Đang tính thống kê…" />) : (
        <>
          <div className="kpi-grid five">
            <Kpi label="Tổng công việc" value={s.total} note={`${s.open} việc đang mở`} to={listLink({})} />
            <Kpi label="Hoàn thành" value={s.completed} note={`${s.total ? Math.round((100 * s.completed) / s.total) : 0}% tổng số`} tone="green" to={listLink({ status: 4 })} />
            <Kpi label="Đúng hạn" value={`${s.onTimePercent}%`} note={`${s.onTimeCount} / ${s.completed} việc hoàn thành`} tone="blue" />
            <Kpi label="Đang quá hạn" value={s.overdue} note={s.overdue ? 'cần xử lý ngay' : 'không có'} tone={s.overdue ? 'red' : ''} to={listLink({ overdue: 1 })} />
            <Kpi label="Đánh giá Đạt" value={s.passed} note={`${s.needsWork} cần bổ sung · ${s.failed} không đạt`} />
          </div>
          <div className="stats-grid">
            <section className="card card-pad stack"><h3>Theo trạng thái</h3><p className="muted small">{s.total} công việc trong kỳ</p><Donut items={s.byStatus} /></section>
            <section className="card card-pad stack"><h3>Tạo và hoàn thành theo tháng</h3><p className="muted small">Số công việc tạo mới so với số đã hoàn thành</p><MonthBars months={s.byMonth} labels={['Tạo mới', 'Hoàn thành']} /></section>
          </div>
          <section className="card table-card">
            <div className="card-head"><h3>Theo đơn vị</h3><p className="muted small">Bấm tên đơn vị để mở danh sách công việc đã lọc</p></div>
            {s.byUnit.length ? (
              <div className="table-wrap"><table className="m-cards"><thead><tr><th>Đơn vị</th><th>Tổng</th><th>Đang mở</th><th>Hoàn thành</th><th>Quá hạn</th><th>Tỷ lệ đúng hạn</th></tr></thead><tbody>
                {s.byUnit.map((u) => (
                  <tr key={u.unitId}>
                    <td><Link className="task-title" to={listLink({ unit: u.unitId })}>{u.unitName} ›</Link></td><td data-label="Tổng">{u.total}</td><td data-label="Đang mở">{u.open}</td><td data-label="Hoàn thành">{u.completed}</td>
                    <td data-label="Quá hạn">{u.overdue ? <b className="red">{u.overdue}</b> : <span className="muted">0</span>}</td>
                    <td data-label="Đúng hạn" className="m-wide"><div className="progress-cell"><Bar value={u.onTimePercent} tone={u.onTimePercent >= 85 ? 'green' : 'orange'} /><b className="small">{u.completed ? u.onTimePercent + '%' : '—'}</b></div></td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <Empty title="Chưa có dữ liệu" description="Kỳ này chưa có công việc." />}
          </section>
          <section className="card table-card">
            <div className="card-head"><h3>Theo nhân sự</h3><p className="muted small">Chỉ tính phân công cá nhân trong kỳ · bấm tên để xem thống kê của người đó</p></div>
            {s.byPerson.length ? (
              <div className="table-wrap"><table className="m-cards"><thead><tr><th>Người thực hiện</th><th>Được giao</th><th>Hoàn thành</th><th>Đúng hạn</th><th>Quá hạn</th><th>Đánh giá Đạt</th></tr></thead><tbody>
                {s.byPerson.map((x) => (
                  <tr key={x.personId}>
                    <td><Link className="pick-who" to={hashOf('/thong-ke-ca-nhan', { person: x.personId })}><Avatar initials={x.initials} tone={x.personId} /><span><strong>{x.name}</strong><small className="muted">{x.unitName}</small></span></Link></td>
                    <td data-label="Được giao">{x.assigned}</td><td data-label="Hoàn thành">{x.completed}</td><td data-label="Đúng hạn">{x.completed ? <b className={x.onTimePercent >= 85 ? 'green' : 'orange'}>{x.onTimePercent}%</b> : '—'}</td>
                    <td data-label="Quá hạn">{x.overdue ? <b className="red">{x.overdue}</b> : <span className="muted">0</span>}</td><td data-label="Đạt">{x.passed}</td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <Empty title="Chưa có phân công cá nhân" />}
          </section>
        </>
      )}
    </>
  );
}

export function PersonalStatsPage() {
  const [params] = useSearchParams();
  const { session } = useSession();
  const access = useAccess();
  const p = periodOf(params), person = params.get('person') ?? '';
  const q = useQuery({
    queryKey: ['stats', 'me', person, p.from, p.to],
    queryFn: () => get<PersonalStatsDto>(`/api/thong-ke/ca-nhan?from=${p.from}&to=${p.to}${person ? '&personId=' + person : ''}`),
    staleTime: 30_000,
  });
  const self = !person || Number(person) === session?.user.id;
  useTitle(self ? 'Thống kê của tôi' : 'Thống kê cá nhân');
  const s = q.data, a = s?.asAssigner;
  const head = (
    <div className="detail-title stats-head">
      <div><h1 tabIndex={-1} id="page-title">{self ? 'Thống kê của tôi' : 'Thống kê cá nhân'}</h1><p className="muted">{s ? `${s.person.name} · ${s.subtitle}` : ''}</p></div>
      <div className="actions">
        {self && access.canViewUnitStats ? <SegLinks label="Phạm vi" value="me" items={[['unit', 'Đơn vị', '/thong-ke'], ['me', 'Của tôi', '/thong-ke-ca-nhan']]} /> : !self ? <ButtonLink to="/thong-ke" kind="secondary">‹ Thống kê đơn vị</ButtonLink> : null}
      </div>
    </div>
  );
  if (!s) return <>{head}<div className="task-filters"><PeriodBar path="/thong-ke-ca-nhan" extra={{ person }} /></div>{q.error ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : <Loading title="Đang tính thống kê…" />}</>;
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.value));
  const kind: Record<string, string> = { result: 'Kết quả chờ đánh giá', extension: 'Yêu cầu gia hạn', accept: 'Chưa tiếp nhận việc' };
  return (
    <>
      {head}
      <div className="task-filters"><PeriodBar path="/thong-ke-ca-nhan" extra={{ person }} /></div>
      {a ? (
        <>
          <h2 className="section-title">Với vai trò người giao việc</h2>
          <div className="kpi-grid four">
            <Kpi label="Việc đã giao" value={a.assigned} note="phân công trong kỳ" />
            <Kpi label="Đang chờ xử lý" value={a.pendingTotal} note={`${a.pendingResults} kết quả · ${a.pendingExtensions} gia hạn · ${a.pendingAccept} tiếp nhận`} tone={a.pendingTotal ? 'orange' : ''} to={self ? '/cho-duyet' : undefined} />
            <Kpi label="Thời gian duyệt trung bình" value={a.averageReviewDays == null ? '—' : `${String(a.averageReviewDays).replace('.', ',')} ngày`} note="từ lúc nộp đến khi đánh giá" tone="blue" />
            <Kpi label="Việc giao bị trễ" value={`${a.late} / ${a.assigned}`} note={a.assigned ? `${Math.round((100 * a.late) / a.assigned)}%` : '—'} tone={a.late ? 'red' : ''} />
          </div>
          {a.pending.length ? (
            <section className="card table-card">
              <div className="card-head"><h3>Đang chờ {self ? 'tôi' : ''} xử lý</h3><p className="muted small">Xếp theo thời gian chờ, lâu nhất lên trước; chờ quá 7 ngày tô cam</p></div>
              <div className="table-wrap"><table><tbody>
                {a.pending.map((x, i) => (
                  <tr key={i}>
                    <td><Link className="task-title" to={`/cong-viec/chi-tiet?id=${x.taskId}&tab=${x.kind === 'result' ? 'result' : 'assign'}`}>{x.title}</Link><small className="muted">{kind[x.kind]} · {x.who}</small></td>
                    <td className="muted small">{fmtDay(x.since)}</td>
                    <td><b className={x.waitingDays > 7 ? 'orange' : 'muted'}>{x.waitingDays ? `Chờ ${x.waitingDays} ngày` : 'Hôm nay'}</b></td>
                  </tr>
                ))}
              </tbody></table></div>
            </section>
          ) : null}
          <h2 className="section-title">Việc được giao cho {self ? 'tôi' : 'người này'}</h2>
        </>
      ) : null}
      <div className="kpi-grid five">
        <Kpi label="Được giao" value={s.assigned} note={`${s.lead} chủ trì · ${s.support} phối hợp`} />
        <Kpi label="Hoàn thành" value={s.completed} note={`${s.assigned ? Math.round((100 * s.completed) / s.assigned) : 0}% số được giao`} tone="green" />
        <Kpi label="Đúng hạn" value={s.completed ? `${s.onTimePercent}%` : '—'} note={`${s.onTimeCount} / ${s.completed}${s.unitAverageOnTime != null ? ` · đơn vị trung bình ${s.unitAverageOnTime}%` : ''}`} tone="blue" />
        <Kpi label="Đang mở" value={s.open} note={`${s.dueSoon} sắp đến hạn · ${s.waitingReview} chờ duyệt`} tone={s.dueSoon ? 'orange' : ''} to={self ? '/cong-viec?scope=assigned' : undefined} />
        <Kpi label="Đánh giá Đạt" value={s.passed} note={`${s.needsWork} lần cần bổ sung · ${s.extensions} lần xin gia hạn`} />
      </div>
      <div className="stats-grid">
        <section className="card card-pad stack"><h3>Theo tháng</h3><p className="muted small">Việc được giao và đã hoàn thành</p><MonthBars months={s.byMonth} /></section>
        <section className="card card-pad stack"><h3>Theo thể loại</h3><p className="muted small">{s.assigned} việc được giao trong kỳ</p>
          {s.byCategory.length ? <div className="hbars">{s.byCategory.map((c) => <div key={c.key} className="hbar"><span>{c.label}</span><Bar value={(100 * c.value) / maxCat} /><b>{c.value}</b></div>)}</div> : <p className="muted">Chưa có dữ liệu.</p>}
        </section>
      </div>
      <section className="card table-card">
        <div className="card-head spread">
          <div><h3>Đơn vị và ban {self ? 'tôi' : ''} tham gia</h3><p className="muted small">{s.memberships.filter((m) => !m.ended).length} đơn vị đang tham gia · công việc giao qua các đơn vị này đều tính vào thống kê</p></div>
          {self ? <Link className="link-button" to={`/ho-so?id=${session?.user.id}`}>Hồ sơ của tôi ›</Link> : null}
        </div>
        {s.memberships.length ? (
          <>
            <div className="table-wrap"><table className="member-stat"><tbody>
              {s.memberships.filter((m) => !m.ended).map((m, i) => (
                <tr key={i}>
                  <td><span className="unit-type">{m.unitType}</span></td>
                  <td><strong>{m.unitName}</strong>{m.primary ? <> <span className="st st-done"><i />Đơn vị chính</span></> : null}<small className="muted">Từ {ymdText(m.start)}{m.end ? ' đến ' + ymdText(m.end) : ''}</small></td>
                  <td><small className="muted">Chức vụ</small><b>{m.role}</b></td>
                  <td className={`${m.openTasks ? 'orange' : 'muted'} small`}>{m.openTasks ? `${m.openTasks} việc đang mở` : 'Không có việc đang mở'}</td>
                  <td><Link className="link-button" to={hashOf('/cong-viec', { scope: self ? 'assigned' : 'all', unit: m.unitId })}>Xem công việc ›</Link></td>
                </tr>
              ))}
            </tbody></table></div>
            {s.memberships.some((m) => m.ended) ? <p className="muted small card-foot">Đã kết thúc: {s.memberships.filter((m) => m.ended).map((m) => `${m.unitName} (${m.role.toLowerCase()}${m.end ? ', đến ' + ymdText(m.end) : ''})`).join('; ')}</p> : null}
          </>
        ) : <Empty title="Chưa thuộc đơn vị nào" description="Liên hệ văn phòng khoa để được thêm vào đơn vị." />}
      </section>
      <p className="muted small">Chỉ {self ? 'bạn' : 'người này'} và người quản lý trực tiếp xem được trang này. Số trung bình đơn vị không hiện tên người khác.</p>
    </>
  );
}
