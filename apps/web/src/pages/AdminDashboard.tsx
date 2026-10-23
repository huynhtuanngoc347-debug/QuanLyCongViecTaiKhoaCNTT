import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AuditRowDto, PersonDto, TaskSummaryDto, UnitStatsDto } from '@khoa/shared';
import { get } from '../api/client';
import { useSession } from '../session';
import { Avatar, Avatars, Badge, Bar, Loading, Prio, PRIORITY, STATUS } from '../ui/ui';
import { Glyph, type GlyphName } from '../ui/glyph';
import { useTaskList } from '../tasks/queries';
import { dueInfo, normalize, pct, relative, todayIso, toDate } from '../format';
import { EvaluationCard, StatTile, StatusCard } from './Dashboard';
import { periodOf } from '../tasks/period';

/**
 * Bảng quản trị hệ thống. Chỉ đọc dữ liệu sẵn có: /api/to-chuc (người dùng, đơn vị, chức vụ, thành viên — đã nạp khi đăng nhập),
 * /api/cong-viec?scope=all và /api/nhat-ky. Mọi thao tác vẫn đi tới các trang quản lý cũ.
 * Thứ tự: Tổng quan → Người dùng & công việc → Giao việc → Giám sát → Cấu hình.
 */
const OPEN = [1, 2, 3, 5];
const PAGE = 8;

function Section({ icon, title, sub, action, children }: { icon: GlyphName; title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="dash-section">
      <header className="dash-head">
        <span className="dash-head-ico" aria-hidden="true"><Glyph name={icon} size={17} /></span>
        <div><h2>{title}</h2>{sub ? <p className="muted small">{sub}</p> : null}</div>
        {action ? <div className="dash-head-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

// ---------------- Bảng có tìm kiếm, sắp xếp, phân trang ----------------
type SortState<K extends string> = { key: K; dir: 1 | -1 };
function SortTh<K extends string>({ k, label, sort, onSort }: { k: K; label: string; sort: SortState<K>; onSort: (k: K) => void }) {
  const on = sort.key === k;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort ${on ? 'on' : ''}`} onClick={() => onSort(k)}>{label}<span aria-hidden="true">{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span></button>
    </th>
  );
}
function useSort<K extends string>(initial: K, dir: 1 | -1 = 1) {
  const [sort, setSort] = useState<SortState<K>>({ key: initial, dir });
  return [sort, (k: K) => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))] as const;
}
function Pager({ page, total, onPage, unit }: { page: number; total: number; onPage: (p: number) => void; unit: string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const from = total ? page * PAGE + 1 : 0, to = Math.min(total, (page + 1) * PAGE);
  return (
    <div className="pager">
      <span className="muted small">{from}–{to} / {total} {unit}</span>
      <div className="pager-buttons">
        <button type="button" className="button small secondary" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Trang trước">‹</button>
        <span className="small">Trang {page + 1} / {pages}</span>
        <button type="button" className="button small secondary" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Trang sau">›</button>
      </div>
    </div>
  );
}

// ---------------- Người dùng ----------------
type Level = 'admin' | 'manager' | 'member' | 'none';
const LEVEL: Record<Level, [string, string]> = { admin: ['Quản trị', 'role-admin'], manager: ['Quản lý', 'role-manager'], member: ['Thành viên', 'role-member'], none: ['Chưa phân công', 'role-none'] };
interface UserRow { p: PersonDto; unit: string; roles: string[]; level: Level }

function UsersTable({ rows, units }: { rows: UserRow[]; units: [number, string][] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(0);
  const [sort, onSort] = useSort<'name' | 'unit' | 'level' | 'status'>('name');
  const shown = useMemo(() => {
    const n = normalize(q);
    const list = rows.filter((r) => (!n || normalize(`${r.p.name} ${r.p.email} ${r.unit} ${r.roles.join(' ')}`).includes(n))
      && (!status || (status === 'active') === r.p.active) && (!level || r.level === level));
    const val = (r: UserRow) => (sort.key === 'name' ? r.p.name.split(' ').slice(-1)[0] + r.p.name : sort.key === 'unit' ? r.unit : sort.key === 'level' ? ['admin', 'manager', 'member', 'none'].indexOf(r.level) : r.p.active ? 0 : 1);
    return list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'vi')) * sort.dir; });
  }, [rows, q, status, level, sort]);
  const reset = (fn: () => void) => { fn(); setPage(0); };
  return (
    <>
      <div className="table-tools">
        <label className="tool-search"><Glyph name="search" size={16} /><input type="search" placeholder="Tìm tên, email, đơn vị, chức vụ…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} aria-label="Tìm người dùng" /></label>
        <select value={level} onChange={(e) => reset(() => setLevel(e.target.value))} aria-label="Vai trò"><option value="">Mọi vai trò</option>{(Object.keys(LEVEL) as Level[]).map((k) => <option key={k} value={k}>{LEVEL[k][0]}</option>)}</select>
        <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Trạng thái"><option value="">Mọi trạng thái</option><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></select>
        <span className="muted small tool-note">{units.length} đơn vị</span>
      </div>
      <div className="table-wrap admin-table">
        <table>
          <thead><tr><SortTh k="name" label="Người dùng" sort={sort} onSort={onSort} /><SortTh k="unit" label="Đơn vị chính" sort={sort} onSort={onSort} /><th scope="col">Chức vụ</th><SortTh k="level" label="Vai trò" sort={sort} onSort={onSort} /><SortTh k="status" label="Trạng thái" sort={sort} onSort={onSort} /><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>
            {shown.slice(page * PAGE, (page + 1) * PAGE).map((r) => (
              <tr key={r.p.id}>
                <td><Link className="cell-person" to={`/ho-so?id=${r.p.id}`}><Avatar initials={r.p.initials} tone={r.p.id} /><span><strong>{r.p.name}</strong><small className="muted">{r.p.email}</small></span></Link></td>
                <td className="cell-clip">{r.unit || <span className="muted">—</span>}</td>
                <td><span className="tag-list">{r.roles.slice(0, 2).map((x) => <span key={x} className="tag">{x}</span>)}{r.roles.length > 2 ? <span className="tag muted">+{r.roles.length - 2}</span> : null}</span></td>
                <td><span className={`role-badge ${LEVEL[r.level][1]}`}>{LEVEL[r.level][0]}</span></td>
                <td>{r.p.active ? <span className="st st-done"><i />Hoạt động</span> : <span className="st st-draft"><i />Đã khóa</span>}</td>
                <td className="row-actions"><Link className="button small ghost" to={`/ho-so?id=${r.p.id}`}>Hồ sơ</Link><Link className="button small secondary" to={`/sua-nhan-su?id=${r.p.id}`}>Sửa</Link></td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={6} className="muted table-empty">Không có người dùng phù hợp.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={shown.length} onPage={setPage} unit="người dùng" />
    </>
  );
}

// ---------------- Công việc ----------------
function TasksTable({ items }: { items: TaskSummaryDto[] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [flag, setFlag] = useState('');
  const [page, setPage] = useState(0);
  const [sort, onSort] = useSort<'title' | 'status' | 'priority' | 'progress' | 'due'>('due');
  const shown = useMemo(() => {
    const n = normalize(q);
    const list = items.filter((t) => (!n || normalize(`${t.title} ${t.unitName} ${t.assignees.map((a) => a.name).join(' ')}`).includes(n))
      && (!status || String(t.status) === status) && (!flag || (flag === 'overdue' ? t.overdue : flag === 'soon' ? t.dueSoon : flag === 'unassigned' ? !t.assignees.length && OPEN.includes(t.status) : t.priority >= 3)));
    const val = (t: TaskSummaryDto): number | string => (sort.key === 'title' ? t.title : sort.key === 'status' ? t.status : sort.key === 'priority' ? -t.priority : sort.key === 'progress' ? Number(t.progress) : t.due ? toDate(t.due).getTime() : Number.MAX_SAFE_INTEGER);
    return list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'vi')) * sort.dir; });
  }, [items, q, status, flag, sort]);
  const reset = (fn: () => void) => { fn(); setPage(0); };
  return (
    <>
      <div className="table-tools">
        <label className="tool-search"><Glyph name="search" size={16} /><input type="search" placeholder="Tìm tiêu đề, đơn vị, người nhận…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} aria-label="Tìm công việc" /></label>
        <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Trạng thái"><option value="">Mọi trạng thái</option>{[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{STATUS[s][0]}</option>)}</select>
        <select value={flag} onChange={(e) => reset(() => setFlag(e.target.value))} aria-label="Cảnh báo"><option value="">Mọi công việc</option><option value="overdue">Quá hạn</option><option value="soon">Sắp đến hạn</option><option value="unassigned">Chưa giao</option><option value="high">Ưu tiên {PRIORITY[3][0].toLowerCase()} trở lên</option></select>
        <Link className="button small secondary tool-note" to="/cong-viec?scope=all">Mở danh sách đầy đủ</Link>
      </div>
      <div className="table-wrap admin-table">
        <table>
          <thead><tr><SortTh k="title" label="Công việc" sort={sort} onSort={onSort} /><SortTh k="status" label="Trạng thái" sort={sort} onSort={onSort} /><SortTh k="priority" label="Ưu tiên" sort={sort} onSort={onSort} /><th scope="col">Người nhận</th><SortTh k="progress" label="Tiến độ" sort={sort} onSort={onSort} /><SortTh k="due" label="Hạn" sort={sort} onSort={onSort} /><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>
            {shown.slice(page * PAGE, (page + 1) * PAGE).map((t) => {
              const due = dueInfo(t.due, OPEN.includes(t.status) && t.status !== 3);
              return (
                <tr key={t.id} className={t.overdue ? 'is-late' : ''}>
                  <td><Link className="task-title" to={`/cong-viec/chi-tiet?id=${t.id}`}>{t.title}</Link><small className="muted">{t.unitName} · tạo bởi {t.creatorName}</small></td>
                  <td><Badge map={STATUS} value={t.status} /></td>
                  <td><Prio value={t.priority} /></td>
                  <td>{t.assignees.length ? <Avatars list={t.assignees} /> : <span className="flag flag-amber">Chưa giao</span>}</td>
                  <td><span className="progress-cell"><Bar value={t.progress} tone={t.status === 4 ? 'green' : t.overdue ? 'red' : ''} /><span className="muted small">{pct(t.progress)}%</span></span></td>
                  <td><span className={`due-chip ${due.cls}`}><Glyph name="calendar" size={13} />{due.text}</span></td>
                  <td className="row-actions"><Link className="button small secondary" to={`/cong-viec/chi-tiet?id=${t.id}`}>Xem</Link></td>
                </tr>
              );
            })}
            {!shown.length ? <tr><td colSpan={7} className="muted table-empty">Không có công việc phù hợp.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={shown.length} onPage={setPage} unit="công việc" />
    </>
  );
}

// ---------------- Thống kê đơn vị ----------------
function UnitStatsTable() {
  const p = periodOf(new URLSearchParams());
  const q = useQuery({ queryKey: ['stats', 'unit', p.from, p.to, '', ''], queryFn: () => get<UnitStatsDto>(`/api/thong-ke/don-vi?from=${p.from}&to=${p.to}`), staleTime: 30_000 });
  const [sort, onSort] = useSort<'name' | 'total' | 'open' | 'completed' | 'overdue' | 'onTime'>('total', -1);
  if (!q.data) return <section className="card dash-card">{q.error ? <p className="muted small">{(q.error as Error).message}</p> : <Loading title="Đang tính thống kê…" />}</section>;
  const val = (u: UnitStatsDto['byUnit'][number]) => ({ name: u.unitName, total: u.total, open: u.open, completed: u.completed, overdue: u.overdue, onTime: u.completed ? u.onTimePercent : -1 })[sort.key];
  const rows = [...q.data.byUnit].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'vi')) * sort.dir; });
  const max = Math.max(1, ...rows.map((u) => u.total));
  return (
    <section className="card admin-panel">
      <div className="dash-card-head panel-head"><h3>Công việc theo đơn vị</h3><span className="muted small">{p.presets.year[2]} · {q.data.byUnit.length} đơn vị</span></div>
      <div className="table-wrap admin-table">
        <table>
          <thead><tr><SortTh k="name" label="Đơn vị" sort={sort} onSort={onSort} /><SortTh k="total" label="Tổng" sort={sort} onSort={onSort} /><SortTh k="open" label="Đang mở" sort={sort} onSort={onSort} /><SortTh k="completed" label="Hoàn thành" sort={sort} onSort={onSort} /><SortTh k="overdue" label="Quá hạn" sort={sort} onSort={onSort} /><SortTh k="onTime" label="Đúng hạn" sort={sort} onSort={onSort} /></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.unitId}>
                <td><Link className="task-title" to={`/cong-viec?scope=all&unit=${u.unitId}`}>{u.unitName}</Link></td>
                <td><span className="progress-cell unit-load"><span className="bar"><b style={{ width: `${(100 * u.total) / max}%` }} /></span><b>{u.total}</b></span></td>
                <td>{u.open}</td>
                <td>{u.completed}</td>
                <td>{u.overdue ? <span className="flag flag-red">{u.overdue}</span> : <span className="muted">0</span>}</td>
                <td>{u.completed ? <span className={`flag ${u.onTimePercent >= 80 ? 'flag-green' : u.onTimePercent >= 50 ? 'flag-amber' : 'flag-red'}`}>{u.onTimePercent}%</span> : <span className="muted">—</span>}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="muted table-empty">Chưa có công việc trong kỳ.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="pager"><span className="muted small">Bấm tên đơn vị để xem danh sách công việc của đơn vị.</span><Link className="button small secondary" to="/thong-ke">Thống kê đầy đủ, xuất Excel</Link></div>
    </section>
  );
}

// ---------------- Giám sát ----------------
const AUDIT: Record<string, [string, GlyphName, string]> = {
  DangNhap: ['Đăng nhập', 'login', 'info'], DangXuat: ['Đăng xuất', 'login', 'muted'], DangNhapThatBai: ['Đăng nhập thất bại', 'lock', 'danger'],
  DoiMatKhau: ['Đổi mật khẩu', 'lock', 'info'], DoiMatKhauThatBai: ['Đổi mật khẩu thất bại', 'lock', 'danger'], CapLaiMatKhau: ['Cấp lại mật khẩu', 'lock', 'warn'],
  TaoNguoiDung: ['Thêm nhân sự', 'userPlus', 'green'], CapNhatNguoiDung: ['Cập nhật nhân sự', 'user', 'info'], XoaNguoiDung: ['Xóa tài khoản', 'user', 'danger'],
  TaoDonVi: ['Thêm đơn vị', 'sitemap', 'green'], CapNhatQuyenChucVu: ['Cập nhật quyền chức vụ', 'shield', 'warn'],
  ThemTheLoai: ['Thêm thể loại', 'tag', 'green'], SuaTheLoai: ['Sửa thể loại', 'tag', 'info'], XoaMauCongViec: ['Xóa mẫu công việc', 'template', 'danger'],
};
const humanize = (code: string) => code.replace(/([a-z])([A-Z])/g, '$1 $2');

function ActivityFeed() {
  const q = useQuery({ queryKey: ['audit', 'admin-feed'], queryFn: () => get<AuditRowDto[]>('/api/nhat-ky?limit=10'), staleTime: 15_000 });
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Nhật ký hệ thống</h3><Link className="link-button" to="/nhat-ky">Xem tất cả <Glyph name="arrow" size={14} /></Link></div>
      {!q.data ? (q.error ? <p className="muted small">{(q.error as Error).message}</p> : <Loading />) : q.data.length ? (
        <ol className="activity">
          {q.data.map((r) => {
            const [label, icon, tone] = AUDIT[r.action] ?? [humanize(r.action), 'log' as GlyphName, 'muted'];
            return (
              <li key={r.id}>
                <span className={`activity-ico noti-ico ${tone}`}><Glyph name={icon} size={15} /></span>
                <span className="activity-text"><span><strong>{r.actor || 'Hệ thống'}</strong> · {label}{r.objectType && r.action !== 'DangNhap' && r.action !== 'DangXuat' ? <span className="muted"> — {r.objectType} {r.objectId}</span> : null}</span><small className="muted">{relative(r.at)}{r.ip ? ` · ${r.ip}` : ''}</small></span>
              </li>
            );
          })}
        </ol>
      ) : <p className="muted small">Chưa có bản ghi.</p>}
    </section>
  );
}

function RecentTasks({ items }: { items: TaskSummaryDto[] }) {
  const list = [...items].sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()).slice(0, 7);
  return (
    <section className="card dash-card">
      <div className="dash-card-head"><h3>Công việc mới tạo & giao</h3><Link className="link-button" to="/cong-viec?scope=all">Danh sách <Glyph name="arrow" size={14} /></Link></div>
      <ol className="activity">
        {list.map((t) => (
          <li key={t.id}>
            <span className="activity-ico noti-ico info"><Glyph name={t.assignees.length ? 'assign' : 'plus'} size={15} /></span>
            <span className="activity-text">
              <Link to={`/cong-viec/chi-tiet?id=${t.id}`}><strong>{t.title}</strong></Link>
              <small className="muted">{t.creatorName} tạo · {relative(t.createdAt)} · {t.assignees.length ? `giao cho ${t.assignees.map((a) => a.name).slice(0, 2).join(', ')}${t.assignees.length > 2 ? ` +${t.assignees.length - 2}` : ''}` : 'chưa giao'}</small>
            </span>
            <Badge map={STATUS} value={t.status} />
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------- Trang ----------------
export function AdminDashboard() {
  const s = useSession();
  const { org } = s;
  const list = useTaskList('all');
  const [tab, setTab] = useState<'users' | 'tasks'>('users');
  const today = todayIso();
  const users = useMemo<UserRow[]>(() => {
    const live = org.memberships.filter((m) => !m.end || m.end >= today);
    return org.people.map((p) => {
      const mine = live.filter((m) => m.personId === p.id).sort((a, b) => Number(b.primary) - Number(a.primary));
      const roles = [...new Set(mine.map((m) => org.roles.find((r) => r.id === m.roleId)?.name).filter(Boolean) as string[])];
      const manager = mine.some((m) => { const r = org.roles.find((x) => x.id === m.roleId); return !!r && (r.permissions.assignTask || r.permissions.manageMembers || r.permissions.createTask); });
      const level: Level = p.isSystemAdmin ? 'admin' : manager ? 'manager' : mine.length ? 'member' : 'none';
      return { p, unit: org.units.find((u) => u.id === mine[0]?.unitId)?.name ?? '', roles, level };
    });
  }, [org, today]);
  if (!s.session) return null;
  const me = s.session.user;
  const items = (list.data?.items ?? []).filter((t) => t.status !== 0 && t.status !== 6);
  const open = items.filter((t) => OPEN.includes(t.status));
  const active = org.people.filter((p) => p.active).length;
  const pending = items.filter((t) => t.status === 1 || t.status === 3);
  const done = items.filter((t) => t.status === 4).length, overdue = items.filter((t) => t.overdue).length;
  const unitsActive = org.units.filter((u) => u.active);
  const unassigned = open.filter((t) => !t.assignees.length && t.status !== 5).length;
  const assignees = new Set(open.flatMap((t) => t.assignees.map((a) => `${a.kind}-${a.id}`))).size;
  const members = new Set(org.memberships.filter((m) => !m.end || m.end >= today).map((m) => m.personId)).size;
  const modules: { icon: GlyphName; title: string; desc: string; metric: string; to: string; links?: [string, string][] }[] = [
    { icon: 'users', title: 'Người dùng', desc: 'Tài khoản, khóa/mở khóa, cấp lại mật khẩu', metric: `${org.people.length} tài khoản · ${org.people.length - active} đã khóa`, to: '/nhan-su' },
    { icon: 'sitemap', title: 'Đơn vị & cơ cấu', desc: 'Khoa, bộ môn, ban, hội đồng và thành viên', metric: `${unitsActive.length} đơn vị · ${members} người tham gia`, to: '/to-chuc' },
    { icon: 'tasks', title: 'Công việc', desc: 'Toàn bộ công việc trong hệ thống (chỉ đọc)', metric: `${open.length} đang mở · ${overdue} quá hạn`, to: '/cong-viec?scope=all' },
    { icon: 'assign', title: 'Giao việc & phân công', desc: 'Ai đang nhận việc, việc chưa có người thực hiện', metric: `${assignees} người/đơn vị nhận việc · ${unassigned} chưa giao`, to: '/cong-viec?scope=all&view=kanban' },
    { icon: 'shield', title: 'Chức vụ & quyền', desc: 'Quyền tạo, giao, duyệt, xem báo cáo theo chức vụ', metric: `${org.roles.length} chức vụ`, to: '/chuc-vu' },
    { icon: 'settings', title: 'Cấu hình hệ thống', desc: 'Danh mục dùng chung và nhật ký', metric: '', to: '/the-loai', links: [['/the-loai', 'Thể loại công việc'], ['/mau-cong-viec', 'Mẫu công việc'], ['/nhat-ky', 'Nhật ký hệ thống']] },
  ];
  const date = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return (
    <div className="admin">
      <header className="admin-header">
        <div className="admin-title">
          <p className="portal-eyebrow">Quản trị hệ thống · {date.charAt(0).toUpperCase() + date.slice(1)}</p>
          <h1 tabIndex={-1} id="page-title">Bảng quản trị</h1>
          
        </div>
        <div className="admin-side">
          <div className="admin-me"><Avatar initials={me.initials} tone={2} /><span><strong>{me.name}</strong><small className="muted">{me.email}</small></span><span className="role-badge role-admin">Quản trị</span></div>
          <div className="portal-actions">
            <Link className="button" to="/them-nhan-su"><Glyph name="userPlus" size={16} />Thêm nhân sự</Link>
            {s.session.capabilities.canCreateUnit ? <Link className="button secondary" to="/them-don-vi"><Glyph name="sitemap" size={16} />Thêm đơn vị</Link> : null}
            <Link className="button secondary" to="/chuc-vu"><Glyph name="shield" size={16} />Phân quyền</Link>
          </div>
        </div>
      </header>

      <div className="dash">
        <Section icon="layers" title="Tổng quan hệ thống">
          <div className="stat-grid seven">
            <StatTile label="Người dùng" value={org.people.length} note={`${org.people.filter((p) => p.isSystemAdmin).length} quản trị viên`} tone="primary" to="/nhan-su" />
            <StatTile label="Đang hoạt động" value={active} note={`${org.people.length - active} tài khoản đã khóa`} tone="green" to="/nhan-su" />
            <StatTile label="Công việc" value={list.data ? items.length : '…'} note={`${open.length} đang mở`} tone="blue" to="/cong-viec?scope=all" />
            <StatTile label="Đang chờ" value={list.data ? pending.length : '…'} note={`${items.filter((t) => t.status === 3).length} chờ duyệt · ${items.filter((t) => t.status === 1).length} chưa bắt đầu`} tone={pending.length ? 'amber' : 'neutral'} to="/cong-viec?scope=all&status=3" />
            <StatTile label="Hoàn thành" value={list.data ? done : '…'} note={`${items.length ? Math.round((100 * done) / items.length) : 0}% tổng số`} tone="green" to="/cong-viec?scope=all&status=4" />
            <StatTile label="Quá hạn" value={list.data ? overdue : '…'} note={overdue ? 'cần nhắc đơn vị xử lý' : 'không có việc trễ'} tone={overdue ? 'red' : 'neutral'} to="/cong-viec?scope=all&overdue=1" />
            <StatTile label="Đơn vị" value={unitsActive.length} note={`${org.units.length - unitsActive.length} ngừng hoạt động`} tone="neutral" to="/to-chuc" />
          </div>
        </Section>

        <Section icon="dashboard" title="Phân hệ quản trị">
          <div className="module-grid">
            {modules.map((m) => (
              <div key={m.title} className="module">
                <Link to={m.to} className="module-main">
                  <span className="module-ico"><Glyph name={m.icon} size={20} /></span>
                  <span className="module-text"><strong>{m.title}</strong><small className="muted">{m.desc}</small>{m.metric ? <span className="module-metric">{m.metric}</span> : null}</span>
                  <Glyph name="arrow" size={16} className="module-go" />
                </Link>
                {m.links ? <span className="module-links">{m.links.map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}</span> : null}
              </div>
            ))}
          </div>
        </Section>

        <Section icon="users" title="Người dùng & công việc">
          <div className="card admin-panel">
            <div className="panel-tabs" role="tablist" aria-label="Bảng dữ liệu">
              <button type="button" role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}><Glyph name="users" size={16} />Người dùng<span className="count">{org.people.length}</span></button>
              <button type="button" role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}><Glyph name="tasks" size={16} />Công việc<span className="count">{items.length}</span></button>
            </div>
            <div className="panel-body" role="tabpanel">
              {tab === 'users' ? <UsersTable rows={users} units={unitsActive.map((u) => [u.id, u.name])} />
                : list.data ? <TasksTable items={items} /> : <Loading title="Đang tải công việc…" />}
            </div>
          </div>
        </Section>

        <Section icon="chart" title="Thống kê đơn vị & đánh giá" sub="Trong kỳ thống kê hiện tại"
          action={<Link className="button small secondary" to="/thong-ke"><Glyph name="chart" size={15} />Trang thống kê</Link>}>
          <UnitStatsTable />
          {list.data ? <div className="dash-grid two top"><StatusCard items={items} base="/cong-viec?scope=all" /><div className="admin-eval"><EvaluationCard /></div></div> : null}
        </Section>

        <Section icon="clock" title="Hoạt động & giám sát">
          <div className="dash-grid two top"><ActivityFeed />{list.data ? <RecentTasks items={items} /> : <Loading />}</div>
        </Section>
      </div>
    </div>
  );
}
