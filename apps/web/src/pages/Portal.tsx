import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PersonalStatsDto } from '@khoa/shared';
import { ApiError, get } from '../api/client';
import { useSession } from '../session';
import { useAccess } from '../nav';
import { ButtonLink, Loading, PageHeader } from '../ui/ui';
import { Glyph } from '../ui/glyph';
import { Dashboard } from './Dashboard';
import { AdminDashboard } from './AdminDashboard';
import { useTaskList } from '../tasks/queries';
import { periodOf } from '../tasks/period';
import { normalize, todayIso, ymdText } from '../format';
import { useTitle } from './common';

// ---------------- Cột phải trang cá nhân: "Kết quả của tôi" ----------------
const PERIOD_ITEMS: ['month' | 'year', string][] = [['month', 'Tháng'], ['year', 'Năm học']];

function MyResultsCard() {
  const [preset, setPreset] = useState<'month' | 'year'>('year');
  const p = periodOf(new URLSearchParams({ period: preset }));
  const [from, to] = [p.presets[preset][0], p.presets[preset][1]];
  const q = useQuery({ queryKey: ['stats', 'me', '', from, to], queryFn: () => get<PersonalStatsDto>(`/api/thong-ke/ca-nhan?from=${from}&to=${to}`), staleTime: 30_000 });
  const s = q.data;
  const head = (
    <header className="me-head">
      <div><h2 id="me-title">Kết quả của tôi</h2><p className="muted small">{p.presets[preset][2]} ({ymdText(from).slice(0, 5)} – {ymdText(to).slice(0, 5)})</p></div>
      <div className="seg me-seg" role="radiogroup" aria-label="Kỳ thống kê">
        {PERIOD_ITEMS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={preset === k} className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>)}
      </div>
    </header>
  );
  if (!s) return <section className="card me-card" aria-labelledby="me-title">{head}{q.error ? <p className="muted">{(q.error as Error).message}</p> : <Loading title="Đang tính…" />}</section>;
  const unitWord = s.unitName && normalize(s.unitName).startsWith('bo mon') ? 'bộ môn' : 'đơn vị';
  const delta = s.unitAverageOnTime != null && s.completed ? s.onTimePercent - s.unitAverageOnTime : null;
  const reviewed = s.passed + s.needsWork + s.failed;
  const max = Math.max(1, ...s.byMonth.flatMap((m) => [m.assigned, m.completed]));
  const nowMonth = todayIso().slice(0, 7);
  const list = (extra: string) => `/cong-viec?scope=assigned${extra}`;
  return (
    <section className="card me-card" aria-labelledby="me-title">
      {head}
      <div className="me-hero">
        <div className="me-ring" style={{ ['--p' as string]: s.completed ? s.onTimePercent : 0 }} role="img" aria-label={`Đúng hạn ${s.completed ? s.onTimePercent + '%' : 'chưa có'}`}>
          <span><b>{s.completed ? `${s.onTimePercent}%` : '—'}</b><small>đúng hạn</small></span>
        </div>
        <div className="me-hero-text">
          <strong>{s.completed ? `${s.onTimeCount} / ${s.completed} việc xong đúng hạn` : 'Chưa có việc hoàn thành trong kỳ'}</strong>
          {s.unitAverageOnTime != null ? <p className="muted small">Trung bình {unitWord} <b>{s.unitAverageOnTime}%</b></p> : <p className="muted small">Chưa có số liệu trung bình {unitWord}</p>}
          {delta != null ? <span className={`me-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? `▲ +${delta}` : `▼ ${delta}`} điểm so với {unitWord}</span> : null}
        </div>
      </div>
      <div className="me-tiles">
        <Link className="me-tile" to={list('')}><small>Được giao</small><b>{s.assigned}</b><span>{s.lead} chủ trì, {s.support} phối hợp</span></Link>
        <Link className="me-tile" to={list('&status=4')}><small>Hoàn thành</small><b className="green">{s.completed}</b><span>{s.assigned ? Math.round((100 * s.completed) / s.assigned) : 0}% số được giao</span></Link>
        <Link className="me-tile" to={list('')}><small>Đang mở</small><b>{s.open}</b><span>{s.waitingReview ? `${s.waitingReview} chờ duyệt kết quả` : `${s.dueSoon} sắp đến hạn`}</span></Link>
        <Link className={`me-tile ${s.overdue ? 'warn' : ''}`} to={list('&overdue=1')}><small>Quá hạn</small><b className={s.overdue ? 'red' : ''}>{s.overdue}</b><span>{s.overdue ? 'cần cập nhật ngay' : 'không có'}</span></Link>
      </div>
      <div className="me-block">
        <div className="me-block-head"><h3>Đánh giá kết quả</h3><span className="muted small">{reviewed} lần được duyệt</span></div>
        <div className="me-stack" role="img" aria-label={`Đạt ${s.passed}, Cần bổ sung ${s.needsWork}, Không đạt ${s.failed}`}>
          {s.passed ? <i className="s-ok" style={{ flex: s.passed }} title={`Đạt: ${s.passed}`} /> : null}
          {s.needsWork ? <i className="s-fix" style={{ flex: s.needsWork }} title={`Cần bổ sung: ${s.needsWork}`} /> : null}
          {s.failed ? <i className="s-no" style={{ flex: s.failed }} title={`Không đạt: ${s.failed}`} /> : null}
        </div>
        <ul className="me-legend"><li><i className="s-ok" />Đạt <b>{s.passed}</b></li><li><i className="s-fix" />Cần bổ sung <b>{s.needsWork}</b></li><li><i className="s-no" />Không đạt <b>{s.failed}</b></li></ul>
      </div>
      <div className="me-block">
        <div className="me-block-head"><h3>Theo tháng</h3><span className="me-key"><i className="light" />Được giao <i />Hoàn thành</span></div>
        <div className="me-months">
          {s.byMonth.map((m) => (
            <div key={m.month} className={`me-mcol ${m.month > nowMonth ? 'future' : ''}`} title={`T${Number(m.month.slice(5))}: ${m.assigned} việc được giao, ${m.completed} hoàn thành`}>
              <div className="me-mpair"><span className="me-b light" style={{ height: `${Math.round((100 * m.assigned) / max)}%` }} /><span className="me-b" style={{ height: `${Math.round((100 * m.completed) / max)}%` }} /></div>
              <small>T{Number(m.month.slice(5))}</small>
            </div>
          ))}
        </div>
      </div>
      <p className="me-note muted small">{s.extensions ? `Xin gia hạn ${s.extensions} lần trong kỳ (${s.approvedExtensions} lần được duyệt, không tính trễ).` : 'Chưa xin gia hạn lần nào trong kỳ.'}</p>
      <Link className="me-more" to={`/thong-ke-ca-nhan?period=${preset}`}>Xem thống kê đầy đủ <span>›</span></Link>
    </section>
  );
}

/** Thẻ "Đơn vị và ban tôi tham gia". */
function MyUnitsCard() {
  const p = periodOf(new URLSearchParams());
  const q = useQuery({ queryKey: ['stats', 'me', '', p.from, p.to], queryFn: () => get<PersonalStatsDto>(`/api/thong-ke/ca-nhan?from=${p.from}&to=${p.to}`), staleTime: 30_000 });
  const list = q.data?.memberships.filter((m) => !m.ended) ?? [];
  return (
    <section className="card me-card me-units" aria-labelledby="units-title">
      <header className="me-head"><div><h2 id="units-title">Đơn vị và ban tôi tham gia</h2><p className="muted small">Việc giao qua các đơn vị này đều tính vào thống kê</p></div></header>
      {!q.data ? <Loading /> : list.length ? list.map((m) => (
        <Link key={`${m.unitId}-${m.role}`} className="me-unit" to={`/cong-viec?scope=assigned&unit=${m.unitId}`}>
          <span className="unit-type">{m.unitType}</span>
          <span><strong>{m.unitName}</strong><small className="muted">{m.role}, {m.primary ? <span className="green">Đơn vị chính</span> : `từ ${ymdText(m.start)}`}</small></span>
          <b>{m.openTasks} <small>việc mở</small></b>
        </Link>
      )) : <p className="muted">Chưa thuộc đơn vị nào. Liên hệ văn phòng khoa để được thêm vào đơn vị.</p>}
    </section>
  );
}

// ---------------- Trang theo vai trò ----------------
/** Phạm vi nhiều đơn vị: hiện 2 đơn vị đầu, phần còn lại mở bằng "+N đơn vị" (vẫn xem được đủ). */
function ScopeText({ text }: { text: string }) {
  const units = text.split(', ').filter(Boolean);
  if (units.length <= 2) return <span id="portal-scope">{text}</span>;
  return (
    <span id="portal-scope" className="portal-scope">
      {units.slice(0, 2).join(', ')}
      <details className="scope-more"><summary>+{units.length - 2} đơn vị</summary><span>{units.slice(2).join(', ')}</span></details>
    </span>
  );
}

export function PortalPage() {
  const s = useSession();
  const access = useAccess();
  const loc = useLocation();
  const key = loc.pathname.slice(1);
  const portal = s.portals.find((p) => p.key === key);
  const [scope, setScope] = useState<string | null>(null);
  const reviewList = useTaskList('review', access.canReviewAny);
  const [params] = useSearchParams();
  useTitle(portal?.title ?? 'Trang');
  // Hỏi lại máy chủ: giao diện chỉ hiển thị, máy chủ quyết định quyền vào trang.
  useEffect(() => {
    let alive = true;
    get<{ scope: string }>(`/api/trang/${encodeURIComponent(key)}`).then((p) => alive && setScope(p.scope)).catch((e) => {
      if (alive && e instanceof ApiError && e.status === 403) window.location.replace('#/' + s.defaultPortal);
    });
    return () => { alive = false; };
  }, [key, s.defaultPortal]);
  if (!portal || !s.session) {
    return (
      <>
        <PageHeader title="Không có quyền vào trang này" description="Tài khoản của bạn không có vai trò tương ứng với trang này." />
        <div className="card card-pad stack"><p>Trang phù hợp với tài khoản của bạn: {s.portals.map((p) => <ButtonLink key={p.key} to={'/' + p.key} kind="secondary">{p.title}</ButtonLink>)}</p></div>
      </>
    );
  }
  if (key === 'admin') return <AdminDashboard />;
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const review = reviewList.data?.counts.review ?? 0;
  // Trang cá nhân gộp cả phần quản lý (trước là Trang Trưởng khoa / Trang bộ môn) khi có quyền giao việc hoặc xem báo cáo.
  const manages = access.canAssignAny || access.canViewUnitStats;
  const personal = key === 'ca-nhan';
  const view = personal && manages && access.caps.isMember ? (params.get('view') === 'cua-toi' ? 'cua-toi' : 'quan-ly') : personal && !manages ? 'cua-toi' : 'quan-ly';
  const header = (
    <header className={`portal-header portal-${key}`} id="portal-header">
      <div className="portal-text">
        <h1 tabIndex={-1} id="page-title">{portal.title}</h1>
        <p className="portal-eyebrow">{s.session.user.name}, {today.charAt(0).toUpperCase() + today.slice(1)}</p>
        <p className="portal-role"><span className="portal-badge">{portal.roleLabel}</span><ScopeText text={scope ?? portal.scope} /></p>
      </div>
      <div className="portal-actions">
        {/* Tạo / giao việc là việc nhập liệu dài: bản điện thoại (chỉ để xem, theo dõi) không đặt ở trang chủ. */}
        {access.canCreate ? <Link className="button m-hide" to="/cong-viec/tao"><Glyph name="plus" size={16} />Tạo công việc</Link> : null}
        {access.canAssignAny ? <Link className="button secondary m-hide" to="/cong-viec?scope=created"><Glyph name="assign" size={16} />Giao việc</Link> : null}
        {access.canReviewAny ? <Link className="button secondary" to="/cho-duyet"><Glyph name="review" size={16} />Chờ duyệt{review ? <span className="btn-count">{review}</span> : null}</Link> : null}
        {/* Điện thoại: trùng tab "Công việc" ở thanh dưới. */}
        {access.caps.isMember ? <Link className={`button m-hide ${access.canCreate ? 'secondary' : ''}`} to="/cong-viec?scope=assigned"><Glyph name="progress" size={16} />Cập nhật tiến độ</Link> : null}
      </div>
    </header>
  );
  const myResults = access.caps.isMember ? <div className="dash-grid two top"><MyResultsCard /><MyUnitsCard /></div> : undefined;
  const switcher = personal && manages && access.caps.isMember ? (
    <nav className="view-switch" aria-label="Góc nhìn">
      <Link to="/ca-nhan" className={view === 'quan-ly' ? 'on' : ''} aria-current={view === 'quan-ly' ? 'page' : undefined}><Glyph name="building" size={16} />Việc tôi quản lý</Link>
      <Link to="/ca-nhan?view=cua-toi" className={view === 'cua-toi' ? 'on' : ''} aria-current={view === 'cua-toi' ? 'page' : undefined}><Glyph name="user" size={16} />Việc của tôi</Link>
    </nav>
  ) : null;
  return <>{header}{switcher}<Dashboard key={view} mode={view === 'cua-toi' ? 'member' : 'manager'} evaluation={myResults} /></>;
}
