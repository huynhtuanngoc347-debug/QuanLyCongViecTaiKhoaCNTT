import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PersonalStatsDto, PersonDto } from '@khoa/shared';
import { get } from '../api/client';
import { useSession } from '../session';
import { useAccess } from '../nav';
import { useUi } from '../ui/ui';
import { Glyph, type GlyphName } from '../ui/glyph';
import { periodOf } from '../tasks/period';
import { currentMembership, normalize } from '../format';

/** Một dòng trong danh sách lối tắt / cài đặt. */
function Row({ to, icon, label, note, tone, onClick }: { to?: string; icon: GlyphName; label: string; note?: string; tone?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className={`mp-row-ico ${tone ?? ''}`}><Glyph name={icon} size={18} /></span>
      <span className="mp-row-text"><b>{label}</b>{note ? <small>{note}</small> : null}</span>
      {to ? <Glyph name="chevron" size={16} /> : null}
    </>
  );
  return to
    ? <Link className={`mp-row ${tone ?? ''}`} to={to}>{body}</Link>
    : <button type="button" className={`mp-row ${tone ?? ''}`} onClick={onClick}>{body}</button>;
}

/** Hồ sơ của chính mình trên điện thoại (tab "Tôi"): thông tin, kết quả học kỳ, đơn vị, lối tắt và tài khoản. */
export function MyProfileMobile({ person }: { person: PersonDto }) {
  const { org, session, logout } = useSession();
  const access = useAccess();
  const navigate = useNavigate();
  const { toast } = useUi();
  const p = periodOf(new URLSearchParams({ period: 'semester' }));
  const [from, to] = [p.presets.semester[0], p.presets.semester[1]];
  const q = useQuery({
    queryKey: ['stats', 'me', '', from, to],
    queryFn: () => get<PersonalStatsDto>(`/api/thong-ke/ca-nhan?from=${from}&to=${to}`),
    staleTime: 30_000, enabled: access.caps.isMember,
  });
  const s = q.data;
  const memberships = org.memberships.filter((m) => m.personId === person.id && currentMembership(m))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
  const unitName = (id: number) => org.units.find((u) => u.id === id)?.name ?? 'Chưa xác định';
  const roleName = (id: number) => org.roles.find((r) => r.id === id)?.name ?? 'Chưa xác định';
  const roles = (session?.user.roleSummary ?? '').split(/[;,]\s*/).filter(Boolean);
  const onTime = s && s.completed ? s.onTimePercent : null;
  const unitWord = s?.unitName && normalize(s.unitName).startsWith('bo mon') ? 'bộ môn' : 'đơn vị';
  const delta = s && s.unitAverageOnTime != null && s.completed ? s.onTimePercent - s.unitAverageOnTime : null;
  const doLogout = async () => {
    try { await logout(); } catch (e) { toast((e as Error).message, true); return; }
    navigate('/', { replace: true });
    toast('Đã đăng xuất.');
  };

  return (
    <div className="mp">
      <section className="mp-hero">
        <div className="mp-avatar" style={{ ['--p' as string]: `${onTime ?? 0}%` }} role="img" aria-label={onTime != null ? `Đúng hạn ${onTime}%` : 'Chưa có số liệu đúng hạn'}>
          <span>{person.initials}</span>
          {onTime != null ? <b>{onTime}%</b> : null}
        </div>
        <h1 id="page-title" tabIndex={-1}>{[person.academicTitle, person.degree].filter(Boolean).map((x) => x.replace('Tiến sĩ', 'TS.').replace('Thạc sĩ', 'ThS.')).join(' ')} {person.name}</h1>
        <p>{person.email}{person.employeeCode ? ` · ${person.employeeCode}` : ''}</p>
        {roles.length ? <div className="mp-chips">{roles.slice(0, 4).map((r) => <span key={r}>{r}</span>)}</div> : null}
      </section>

      {access.caps.isMember ? (
        <>
          <section className="mp-stats" aria-label="Công việc trong học kỳ">
            <Link to="/cong-viec?scope=assigned"><b>{s?.assigned ?? '–'}</b><small>Được giao</small></Link>
            <Link to="/cong-viec?scope=assigned&status=4"><b className="green">{s?.completed ?? '–'}</b><small>Hoàn thành</small></Link>
            <Link to="/cong-viec?scope=assigned&overdue=1"><b className={s?.overdue ? 'red' : ''}>{s?.overdue ?? '–'}</b><small>Quá hạn</small></Link>
          </section>

          <section className="mp-card mp-rate" aria-labelledby="mp-rate-title">
            <div className="mp-card-head"><h2 id="mp-rate-title">Tỷ lệ đúng hạn</h2><span>{p.presets.semester[2]}</span></div>
            {!s ? <p className="muted small">{q.error ? (q.error as Error).message : 'Đang tính…'}</p> : (
              <>
                <div className="mp-rate-big">
                  <b>{onTime != null ? `${onTime}%` : '—'}</b>
                  {delta != null ? <span className={`mp-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? `+${delta}` : delta} so với {unitWord}</span>
                    : <span className="muted small">{s.completed ? '' : 'Chưa có việc hoàn thành trong kỳ'}</span>}
                </div>
                <div className="mp-bar" role="img" aria-label={`Bạn ${onTime ?? 0}%, trung bình ${unitWord} ${s.unitAverageOnTime ?? 'chưa có'}%`}>
                  <i style={{ width: `${onTime ?? 0}%` }} />
                  {s.unitAverageOnTime != null ? <em style={{ left: `${s.unitAverageOnTime}%` }} /> : null}
                </div>
                <div className="mp-bar-note"><span>Đạt {s.passed} · Cần bổ sung {s.needsWork}{s.failed ? ` · Không đạt ${s.failed}` : ''}</span>{s.unitAverageOnTime != null ? <span>{unitWord.charAt(0).toUpperCase() + unitWord.slice(1)} {s.unitAverageOnTime}%</span> : null}</div>
              </>
            )}
          </section>
        </>
      ) : null}

      <section className="mp-card" aria-labelledby="mp-units-title">
        <div className="mp-card-head"><h2 id="mp-units-title">Đơn vị tham gia</h2><span>{memberships.length}</span></div>
        {memberships.length ? memberships.map((m, i) => (
          <Link key={i} className="mp-unit" to={`/cong-viec?scope=assigned&unit=${m.unitId}`}>
            <span className="mp-unit-ico"><Glyph name="building" size={17} /></span>
            <span className="mp-row-text"><b>{unitName(m.unitId)}</b><small>{roleName(m.roleId)}{m.primary ? ' · Đơn vị chính' : ''}</small></span>
            <Glyph name="chevron" size={16} />
          </Link>
        )) : <p className="muted small">Chưa thuộc đơn vị nào.</p>}
      </section>

      <section className="mp-card mp-list" aria-label="Lối tắt">
        {access.caps.isMember ? <Row to="/thong-ke-ca-nhan" icon="userChart" label="Thống kê của tôi" note="Theo tháng, học kỳ, năm học" /> : null}
        {access.canViewUnitStats ? <Row to="/thong-ke" icon="chart" label="Thống kê đơn vị" /> : null}
        {access.hasManageScope ? <Row to="/nhan-su" icon="users" label="Nhân sự" /> : null}
        {access.hasManageScope ? <Row to="/to-chuc" icon="sitemap" label="Cơ cấu tổ chức" /> : null}
      </section>

      <section className="mp-card mp-list" aria-label="Tài khoản">
        <Row to="/doi-mat-khau" icon="lock" label="Đổi mật khẩu" />
        <Row icon="logout" label="Đăng xuất" tone="danger" onClick={() => void doLogout()} />
      </section>
    </div>
  );
}
