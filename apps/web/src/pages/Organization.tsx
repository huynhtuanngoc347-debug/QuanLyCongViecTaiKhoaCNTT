import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CreatedPersonDto, CreatedUnitDto, MembershipDto, OrganizationDto, PersonDto, RoleDto, UnitDto } from '@khoa/shared';
import { ApiError, api, send } from '../api/client';
import { useSession } from '../session';
import { useAccess } from '../nav';
import { Avatar, ButtonLink, Empty, ErrorSummary, Field, Icon, Input, PageHeader, Select, Seg, Textarea, useUi, type Option } from '../ui/ui';
import { currentMembership, normalize, today, ymdText } from '../format';
import { formValues, useDirtyGuard, useTitle } from './common';
import { UnitPicker } from '../ui/UnitPicker';
import { PersonPicker } from '../ui/PersonPicker';
import { Glyph } from '../ui/glyph';
import { Combobox, type ComboOption } from '../ui/Combobox';
import { useIsMobile } from '../ui/useIsMobile';
import { MyProfileMobile } from './MyProfile';
import { NEW_PARENT, NO_PARENT, PERMISSIONS, UNIT_TYPES, membershipErrors, passwordErrors, personBody, personErrors, unitBody, unitErrors } from './orgValidation';

const PersonLink = ({ p, contact = false }: { p: PersonDto; contact?: boolean }) => (
  <Link className="person-link" to={`/ho-so?id=${p.id}`} aria-label={`Xem hồ sơ ${p.name}`}>
    <Avatar initials={p.initials} tone={p.id - 1} />
    <span><strong>{p.name}</strong>{contact ? <small>{p.email}</small> : null}</span>
  </Link>
);

// ===================== CƠ CẤU TỔ CHỨC =====================
export function OrganizationPage() {
  const { org, session } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  useTitle('Cơ cấu tổ chức');
  const requested = Number(params.get('unit'));
  const unitId = org.units.some((u) => u.id === requested) ? requested : (org.units.find((u) => u.parentId !== null) ?? org.units[0])?.id;
  const unit = org.units.find((u) => u.id === unitId);
  const roleName = (id: number) => org.roles.find((r) => r.id === id)?.name ?? 'Chưa xác định';
  const unitName = (id: number | null) => org.units.find((u) => u.id === id)?.name ?? 'Chưa xác định';
  const members = (id: number) => org.memberships.filter((m) => m.unitId === id && currentMembership(m));
  const memberCount = (id: number) => new Set(members(id).map((m) => m.personId)).size;
  const canCreateUnit = session?.capabilities.canCreateUnit === true;
  const { canManageUnit } = useSession();

  const q = normalize(search);
  function branch(parentId: number | null, depth = 0): React.ReactNode[] {
    return org.units.filter((u) => u.parentId === parentId).map((u) => {
      const children = branch(u.id, depth + 1);
      const match = !q || normalize(`${u.name} ${u.code} ${u.type}`).includes(q);
      if (!match && !children.length) return null;
      const selected = u.id === unitId, root = u.parentId === null, count = memberCount(u.id);
      return (
        <div key={u.id}>
          <button className={`unit-entry ${selected ? 'selected' : ''} ${root ? 'root-unit' : ''}`} data-unit={u.id} aria-pressed={selected} onClick={() => navigate(`/to-chuc?unit=${u.id}`)}>
            <Icon name={root ? 'faculty' : selected ? 'folderActive' : 'folder'} />
            <span><strong>{u.name}</strong>{root ? null : <small>{u.type}{count ? ` · ${count} thành viên` : ''}{u.active ? '' : ' · Ngừng hoạt động'}</small>}</span>
          </button>
          {children.length ? <div className={depth > 0 ? 'unit-branch' : ''}>{children}</div> : null}
        </div>
      );
    }).filter(Boolean);
  }
  if (!unit) return <><PageHeader title="Không tìm thấy đơn vị" description="Đơn vị không còn tồn tại hoặc đường dẫn không hợp lệ." /><ButtonLink to="/to-chuc">Về danh sách đơn vị</ButtonLink></>;
  const people = new Map<number, MembershipDto[]>();
  for (const m of members(unit.id)) people.set(m.personId, [...(people.get(m.personId) ?? []), m]);
  const tree = branch(null);
  return (
    <>
      <PageHeader title="Cơ cấu tổ chức" description="Đơn vị, con người và vai trò — trong cùng một không gian." action={canCreateUnit ? <ButtonLink to={`/them-don-vi?parent=${unit.id}`}>+  Thêm đơn vị</ButtonLink> : undefined} />
      <div className="card org-layout">
        <aside className="explorer" aria-label="Danh sách đơn vị">
          <h2>Đơn vị trong khoa</h2>
          <input className="search-input" id="unit-search" type="search" placeholder="Tìm đơn vị…" aria-label="Tìm đơn vị" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="unit-tree" id="unit-tree">{tree.length ? tree : <Empty title="Không tìm thấy đơn vị" description="Thử tên hoặc mã đơn vị khác." />}</div>
        </aside>
        <section className="unit-detail" id="unit-detail">
          <header className="unit-overview">
            <div className="unit-identity">
              <div className="unit-tile"><Icon name="folderLarge" /></div>
              <div><p className="eyebrow">{unit.type} · Mã {unit.code}</p><h2>{unit.name}</h2><p>{unit.parentId ? unitName(unit.parentId) : 'Đơn vị gốc'}</p></div>
            </div>
            <div className="metadata">
              <dl><dt>Trạng thái</dt><dd className={unit.active ? 'green' : 'muted'}>{unit.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</dd></dl>
              <dl><dt>Thành viên</dt><dd>{people.size ? `${people.size} người` : 'Chưa có'}</dd></dl>
              <dl><dt>Đơn vị cha</dt><dd>{unit.parentId ? unitName(unit.parentId) : 'Không có'}</dd></dl>
            </div>
            {unit.description ? <p className="unit-description">{unit.description}</p> : null}
          </header>
          <section className="members" aria-labelledby="members-title">
            <div className="section-toolbar">
              <h2 id="members-title">Thành viên</h2><span className="count">{people.size}</span>
              {unit.active && canManageUnit(unit.id) ? <ButtonLink to={`/them-thanh-vien?unit=${unit.id}`}>+  Thêm thành viên</ButtonLink> : null}
            </div>
            {people.size ? (
              <>
                <div className="table-wrap">
                  <table className="member-table m-cards" aria-label="Thành viên đơn vị">
                    <thead><tr><th scope="col">Họ và tên</th><th scope="col">Chức vụ</th><th scope="col">Đơn vị chính</th></tr></thead>
                    <tbody>
                      {[...people.entries()].map(([id, ms]) => {
                        const person = org.people.find((p) => p.id === id);
                        return (
                          <tr key={id}>
                            <td>{person ? <PersonLink p={person} contact /> : id}</td>
                            <td data-label="Chức vụ">{ms.map((m, i) => <span key={i}>{i ? <br /> : null}{roleName(m.roleId)}</span>)}</td>
                            <td data-label="Loại">{ms.some((m) => m.primary) ? <span className="badge">Đơn vị chính</span> : <span className="muted">Kiêm nhiệm</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer"><span>{people.size} thành viên đang tham gia</span></div>
              </>
            ) : <Empty title="Chưa có thành viên đang tham gia" description="Thêm người dùng có sẵn vào đơn vị để bắt đầu." />}
          </section>
        </section>
      </div>
    </>
  );
}

// ===================== NHÂN SỰ =====================
export function StaffPage() {
  const { org, isAdmin } = useSession();
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  // Mặc định hiện tất cả để thấy rõ cả người đang hoạt động lẫn đã ngừng; lọc nhanh bằng các thẻ trạng thái.
  const [status, setStatus] = useState('');
  useTitle('Nhân sự');
  const matches = org.people.filter((p) => (!search || normalize(`${p.name} ${p.email} ${p.employeeCode}`).includes(normalize(search)))
    && (!unit || org.memberships.some((m) => m.personId === p.id && m.unitId === Number(unit) && currentMembership(m))));
  const activeCount = matches.filter((p) => p.active).length, inactiveCount = matches.length - activeCount;
  const list = matches.filter((p) => !status || p.active === (status === 'active'))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.split(' ').slice(-1)[0].localeCompare(b.name.split(' ').slice(-1)[0], 'vi') || a.name.localeCompare(b.name, 'vi'));
  const primaryUnit = (pid: number) => {
    const m = org.memberships.find((x) => x.personId === pid && x.primary && currentMembership(x)) ?? org.memberships.find((x) => x.personId === pid && currentMembership(x));
    return m ? org.units.find((u) => u.id === m.unitId)?.name ?? '' : '';
  };
  const tabs: [string, string, number, string][] = [['', 'Tất cả', matches.length, ''], ['active', 'Đang hoạt động', activeCount, 'tone-on'], ['inactive', 'Ngừng hoạt động', inactiveCount, 'tone-off']];
  return (
    <>
      <PageHeader title="Nhân sự" description="Một hồ sơ cho mỗi người dùng; quản lý đơn vị và chức vụ theo từng lần tham gia." action={isAdmin ? <ButtonLink to="/them-nhan-su">+  Thêm nhân sự</ButtonLink> : undefined} />
      <section className="card staff-card">
        <div className="staff-status-tabs" role="tablist" aria-label="Lọc theo trạng thái">
          {tabs.map(([k, l, n, tone]) => (
            <button key={k || 'all'} type="button" role="tab" aria-selected={status === k} className={`status-tab ${status === k ? 'on' : ''} ${tone}`} onClick={() => setStatus(k)}>
              {tone ? <i aria-hidden="true" /> : null}{l}<b>{n}</b>
            </button>
          ))}
        </div>
        <div className="filters staff-filters">
          <Input name="staff-search" label="Tìm kiếm" type="search" placeholder="Nhập tên, email hoặc mã nhân sự…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select name="staff-unit" label="Đơn vị" options={org.units.map((u) => [u.id, u.name])} placeholder="Tất cả đơn vị" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div id="staff-results" aria-live="polite">
          {list.length ? (
            <>
              <div className="table-wrap admin-table">
                <table className="m-cards" aria-label="Danh sách nhân sự">
                  <thead><tr><th>Họ và tên</th><th>Đơn vị chính</th><th>Học hàm / Học vị</th><th>Email</th><th>Trạng thái</th></tr></thead>
                  <tbody>{list.map((p) => (
                    <tr key={p.id} className={p.active ? '' : 'row-inactive'}>
                      <td><PersonLink p={p} /></td>
                      <td data-label="Đơn vị">{primaryUnit(p.id) || <span className="muted">Chưa thuộc đơn vị</span>}</td>
                      <td data-label="Học vị">{[p.academicTitle, p.degree, p.training].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                      <td data-label="Email"><a href={`mailto:${p.email}`}>{p.email}</a></td>
                      <td data-label="Trạng thái">{p.active
                        ? <span className="st st-done"><i />Đang hoạt động</span>
                        : <span className="st st-cancel staff-off"><Glyph name="lock" size={13} />Ngừng hoạt động</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="muted staff-foot"><small>Hiển thị {list.length} / {org.people.length} hồ sơ · <span className="green">{activeCount} đang hoạt động</span> · <span className="red">{inactiveCount} ngừng hoạt động</span></small></p>
            </>
          ) : <Empty title="Không tìm thấy nhân sự" description="Hãy đổi từ khóa hoặc bỏ bớt bộ lọc." action={<button className="button secondary" onClick={() => { setSearch(''); setUnit(''); setStatus(''); }}>Xóa bộ lọc</button>} />}
        </div>
      </section>
    </>
  );
}

// ===================== CHỨC VỤ VÀ QUYỀN =====================
export function PermissionsPage() {
  const { org, session, reloadOrg, refreshSession } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useUi();
  const guard = useDirtyGuard();
  const role: RoleDto | undefined = org.roles.find((r) => r.id === Number(params.get('role'))) ?? org.roles[0];
  const [draft, setDraft] = useState<{ id: number; values: Record<string, boolean> } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useTitle('Chức vụ và quyền');
  if (!role) return <PageHeader title="Chức vụ và quyền" description="Chưa có chức vụ." />;
  const values = draft?.id === role.id ? draft.values : (role.permissions as Record<string, boolean>);
  const canEdit = session?.capabilities.canEditRoles === true;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body = Object.fromEntries(PERMISSIONS.map(([k]) => [k, values[k] === true]));
    try {
      const r = await send<RoleDto>('PUT', `/api/chuc-vu/${role!.id}/quyen`, body);
      if (r.errors) { setError(Object.values(r.errors)[0]); return; }
      guard.markClean(); setDraft(null); setSaved(true);
      await reloadOrg(); await refreshSession();
      toast('Đã lưu quyền nghiệp vụ của chức vụ.');
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <>
      <PageHeader title="Chức vụ và quyền" description="Thiết lập quyền nghiệp vụ theo chức vụ và phạm vi đơn vị." />
      <section className="card permissions-layout">
        <nav className="position-list" aria-label="Danh mục chức vụ">
          <h2>Chức vụ</h2>
          {org.roles.map((r) => <button key={r.id} className={`position-button ${r.id === role.id ? 'selected' : ''}`} aria-pressed={r.id === role.id} onClick={() => { setSaved(false); navigate(`/chuc-vu?role=${r.id}`); }}>{r.name}{r.active === false ? ' (ngừng)' : ''}</button>)}
        </nav>
        <form id="permissions-form" className="permission-panel" noValidate onSubmit={save}>
          <h2>{role.name}</h2>
          <p>Phạm vi: đơn vị đang đảm nhiệm chức vụ</p>
          <div id="form-error" className="form-error" role="alert" hidden={!error}>{error}</div>
          <div className="table-wrap">
            <table className="permission-table" aria-label={`Quyền của ${role.name}`}>
              <thead><tr><th>Quyền nghiệp vụ</th><th>Thiết lập</th></tr></thead>
              <tbody>{PERMISSIONS.map(([key, label]) => (
                <tr key={key}><td id={`label-${key}`}>{label}</td><td>
                  <label className="permission-toggle">
                    <input type="checkbox" name={key} aria-labelledby={`label-${key}`} checked={values[key] === true} disabled={!canEdit}
                      onChange={(e) => { guard.markDirty(); setSaved(false); setDraft({ id: role.id, values: { ...values, [key]: e.target.checked } }); }} />
                    <span>{values[key] ? 'Cho phép' : 'Không cho phép'}</span>
                  </label>
                </td></tr>
              ))}</tbody>
            </table>
          </div>
          {canEdit ? <div className="actions"><button className="button" type="submit">Lưu thay đổi</button><span className="pending-note" id="permission-pending">{draft ? 'Có thay đổi chưa lưu' : saved ? 'Đã lưu' : ''}</span></div> : null}
        </form>
      </section>
    </>
  );
}

// ===================== THÊM THÀNH VIÊN =====================
export function MemberFormPage() {
  const { org, session, canManageUnit, reloadOrg, refreshSession } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useUi();
  const guard = useDirtyGuard();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState('');
  const [personId, setPersonId] = useState(params.get('person') ?? '');
  const [unitId, setUnitId] = useState(params.get('unit') ?? '');
  const [draft, setDraft] = useState<Record<string, string>>({});
  useTitle('Thêm thành viên');
  const manageable = org.units.filter((u) => u.active && canManageUnit(u.id));
  if (!manageable.length) return <><PageHeader title="Thêm thành viên" description="Bạn chưa có quyền quản lý thành viên ở đơn vị nào." /><div className="card card-pad"><ButtonLink to="/to-chuc" kind="secondary">Về cơ cấu tổ chức</ButtonLink></div></>;
  const roles = org.roles.filter((r) => r.active !== false && (session?.user.isSystemAdmin || !r.permissions.manageMembers));
  const unitParam = params.get('unit') ?? '';
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setMessage('');
    const local = membershipErrors(org, v);
    if (Object.keys(local).length) { setErrors(local); return; }
    try {
      const r = await send<MembershipDto>('POST', '/api/thanh-vien', { personId: Number(v.personId), unitId: Number(v.unitId), roleId: Number(v.roleId), start: v.start, end: v.end || '', primary: v.primary === 'true' });
      if (r.errors) { setErrors(r.errors); return; }
      guard.markClean();
      await reloadOrg(); await refreshSession();
      navigate(`/to-chuc?unit=${r.value.unitId}`);
      toast('Đã thêm thành viên vào đơn vị.');
    } catch (err) { setMessage((err as Error).message); }
  }
  const primaryUnitOf = (pid: number) => {
    const m = org.memberships.find((x) => x.personId === pid && x.primary && currentMembership(x));
    return m ? org.units.find((u) => u.id === m.unitId)?.name ?? '' : '';
  };
  const values = { personId, unitId, roleId: draft.roleId ?? '', start: draft.start ?? today(), end: draft.end ?? '', primary: draft.primary ?? 'false' };
  return (
    <>
      <PageHeader title="Thêm thành viên" description="Gán người dùng có sẵn vào đơn vị và xác định chức vụ đảm nhiệm." />
      <div className="form-layout">
        <section className="card form-card">
          <form id="membership-form" noValidate onSubmit={submit} onInput={(e) => { guard.markDirty(); setDraft(formValues(e.currentTarget)); }}>
            <ErrorSummary errors={errors} message={message} />
            <div className="form-body">
              <fieldset className="form-section">
                <legend>Người và đơn vị</legend>
                <div className="two-col">
                  <PersonPicker name="personId" label="Người dùng *" people={org.people.filter((p) => p.active)} value={personId} error={errors?.personId}
                    subtitle={(p) => primaryUnitOf(p.id)} onChange={(v) => { setPersonId(v); guard.markDirty(); }} />
                  <UnitPicker name="unitId" label="Đơn vị *" units={manageable} value={unitId} placeholder="Chọn đơn vị" specials={[]} error={errors?.unitId}
                    onChange={(v) => { setUnitId(v); guard.markDirty(); }} />
                </div>
              </fieldset>
              <fieldset className="form-section">
                <legend>Chức vụ và thời gian</legend>
                <div className="two-col">
                  <Select name="roleId" label="Chức vụ *" options={roles.map((r) => [r.id, r.name])} placeholder="Chọn chức vụ" defaultValue="" error={errors?.roleId} />
                  <Field name="primary" label="Đơn vị chính" error={errors?.primary}><Seg name="primary" items={[['false', 'Không (kiêm nhiệm)'], ['true', 'Có']]} value="false" /></Field>
                </div>
                <div className="two-col">
                  <Input name="start" label="Ngày tham gia *" type="date" defaultValue={today()} required error={errors?.start} />
                  <Input name="end" label="Ngày kết thúc" type="date" defaultValue="" min={values.start || undefined} help="Để trống nếu chưa xác định." error={errors?.end} />
                </div>
              </fieldset>
              <div className="actions form-actions"><button className="button" type="submit">Thêm thành viên</button><ButtonLink to={`/to-chuc${unitParam ? '?unit=' + unitParam : ''}`} kind="secondary">Hủy</ButtonLink></div>
            </div>
          </form>
        </section>
        <MemberPreview org={org} values={values} />
      </div>
    </>
  );
}

/** Cột phải trang Thêm thành viên: người → đơn vị → chức vụ (kèm quyền), các đơn vị đang tham gia, cảnh báo trùng sớm. */
function MemberPreview({ org, values }: { org: OrganizationDto; values: Record<string, string> }) {
  const person = org.people.find((p) => String(p.id) === values.personId);
  const unit = org.units.find((u) => String(u.id) === values.unitId);
  const role = org.roles.find((r) => String(r.id) === values.roleId);
  const perms = role ? PERMISSIONS.filter(([k]) => role.permissions[k as keyof typeof role.permissions]).map(([, l]) => l) : [];
  const current = person ? org.memberships.filter((m) => m.personId === person.id && currentMembership(m)) : [];
  // Cảnh báo sớm: dùng đúng quy tắc kiểm tra khi lưu (trùng chức vụ, xung đột đơn vị chính).
  const issues = person && unit && role ? Object.entries(membershipErrors(org, values)).filter(([k]) => k === 'roleId' || k === 'primary').map(([, m]) => m) : [];
  return (
    <aside className="card form-aside" aria-label="Xem trước">
      <h2>Xem trước</h2>
      <div className="member-flow">
        <div className={`flow-step ${person ? '' : 'empty'}`}>
          {person ? <Avatar initials={person.initials} tone={person.id} /> : <span className="flow-ico"><Glyph name="user" size={18} /></span>}
          <span><small>Người dùng</small><strong>{person?.name ?? 'Chưa chọn'}</strong>{person ? <small className="muted">{person.email}</small> : null}</span>
        </div>
        <div className={`flow-step ${unit ? '' : 'empty'}`}>
          <span className="flow-ico"><Glyph name="sitemap" size={18} /></span>
          <span><small>Đơn vị</small><strong>{unit?.name ?? 'Chưa chọn'}</strong>{unit ? <small className="muted">{unit.type}{values.primary === 'true' ? ' · đơn vị chính' : ' · kiêm nhiệm'}</small> : null}</span>
        </div>
        <div className={`flow-step ${role ? '' : 'empty'}`}>
          <span className="flow-ico"><Glyph name="shield" size={18} /></span>
          <span><small>Chức vụ</small><strong>{role?.name ?? 'Chưa chọn'}</strong>
            {role ? <span className="tag-list">{perms.length ? perms.map((p) => <span key={p} className="tag">{p}</span>) : <span className="tag muted">Chỉ nhận và thực hiện việc</span>}</span> : null}</span>
        </div>
      </div>
      {issues.map((m) => <div key={m} className="notice warn">{m}</div>)}
      {person ? (
        <div className="aside-tips">
          <h3>Đang tham gia ({current.length})</h3>
          {current.length ? (
            <ul className="member-current">
              {current.map((m, i) => <li key={i}><span>{org.units.find((u) => u.id === m.unitId)?.name}</span><span className="muted">{org.roles.find((r) => r.id === m.roleId)?.name}{m.primary ? ' · chính' : ''}</span></li>)}
            </ul>
          ) : <p className="muted small">Chưa thuộc đơn vị nào.</p>}
        </div>
      ) : (
        <div className="aside-tips">
          <h3>Lưu ý</h3>
          <ul>
            <li>Mỗi người chỉ có một <b>đơn vị chính</b> tại một thời điểm; các đơn vị khác là kiêm nhiệm.</li>
            <li>Quyền giao việc, duyệt, xem báo cáo đi theo <b>chức vụ</b> tại đơn vị.</li>
            <li>Chưa có tài khoản? Thêm ở trang <b>Nhân sự</b> trước.</li>
          </ul>
        </div>
      )}
    </aside>
  );
}

// ===================== THÊM ĐƠN VỊ =====================
export function UnitFormPage() {
  const { org, session, reloadOrg, refreshSession } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useUi();
  const guard = useDirtyGuard();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState('');
  // Hệ thống chỉ phục vụ một khoa (đơn vị gốc): đơn vị mới mặc định trực thuộc khoa, không tạo thêm đơn vị gốc.
  const root = org.units.find((u) => u.parentId == null);
  const requested = org.units.find((u) => u.id === Number(params.get('parent')) && u.active);
  const [parentId, setParentId] = useState(requested ? String(requested.id) : root ? String(root.id) : '');
  const [newParentParent, setNewParentParent] = useState(root ? String(root.id) : NO_PARENT);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useTitle('Thêm đơn vị');
  if (!session?.capabilities.canCreateUnit) return <><PageHeader title="Thêm đơn vị" description="Chỉ quản trị hệ thống được thêm đơn vị vào cơ cấu." /><div className="card card-pad"><ButtonLink to="/to-chuc" kind="secondary">Về cơ cấu tổ chức</ButtonLink></div></>;
  // Gợi ý loại đơn vị (bỏ "Khoa": hệ thống chỉ có một khoa) kèm số đơn vị đang có của từng loại.
  const types: ComboOption[] = [...new Map([...UNIT_TYPES, ...org.units.map((u) => u.type)].filter(Boolean).map((t) => [normalize(t), t])).values()]
    .filter((t) => normalize(t) !== 'khoa')
    .map((t) => { const n = org.units.filter((u) => normalize(u.type) === normalize(t)).length; return [t, n ? `${n} đơn vị` : ''] as ComboOption; });
  const typeInput = (name: string, label: string) => (
    <Field name={name} label={label} error={errors?.[name]}>
      <Combobox name={name} label={label} options={types} maxLength={30} placeholder="Chọn hoặc nhập loại mới" invalid={!!errors?.[name]} />
    </Field>
  );
  const showNew = parentId === NEW_PARENT || Object.keys(errors ?? {}).some((k) => k.startsWith('newParent'));
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setMessage('');
    const local = unitErrors(org, v);
    if (Object.keys(local).length) { setErrors(local); return; }
    try {
      const r = await send<CreatedUnitDto>('POST', '/api/don-vi', unitBody(v));
      if (r.errors) { setErrors(r.errors); return; }
      guard.markClean();
      await reloadOrg(); await refreshSession();
      navigate(`/to-chuc?unit=${r.value.unit.id}`);
      toast(r.value.createdParent ? `Đã tạo đơn vị cha ${r.value.createdParent.name} (mã ${r.value.createdParent.id}) và đơn vị ${r.value.unit.name} (mã ${r.value.unit.id}).` : `Đã tạo đơn vị ${r.value.unit.name} (mã ${r.value.unit.id}).`);
    } catch (err) { setMessage((err as Error).message); }
  }
  return (
    <>
      <PageHeader title="Thêm đơn vị" description="Tạo đơn vị mới trong cơ cấu tổ chức." />
      <div className="form-layout">
        <section className="card form-card">
          <h2>Thông tin cơ bản</h2>
          <form id="unit-form" noValidate onSubmit={submit} onInput={(e) => { guard.markDirty(); setDraft(formValues(e.currentTarget)); }}>
            <ErrorSummary errors={errors} message={message} />
            <div className="form-body">
              <Input name="name" label="Tên đơn vị *" required maxLength={150} placeholder="Ví dụ: Nhóm nghiên cứu Trí tuệ nhân tạo" autoComplete="off" error={errors?.name} />
              <div className="two-col">
                {typeInput('type', 'Loại đơn vị *')}
                <UnitPicker name="parentId" label="Đơn vị cha *" units={org.units} value={parentId} placeholder="Chọn đơn vị cha" error={errors?.parentId}
                  onChange={(v) => { setParentId(v); guard.markDirty(); }}
                  specials={[{ value: NEW_PARENT, label: 'Tạo đơn vị cha mới', hint: 'Ví dụ tạo Trung tâm mới rồi đặt đơn vị này bên trong', icon: 'plus' }]} />
              </div>
              <fieldset id="new-parent-box" className="new-parent" hidden={!showNew}>
                <legend>Đơn vị cha mới</legend>
                <Input name="newParentName" label="Tên đơn vị cha mới *" maxLength={150} autoComplete="off" placeholder="Ví dụ: Trung tâm Dữ liệu lớn" error={errors?.newParentName} />
                <div className="two-col">
                  {typeInput('newParentType', 'Loại đơn vị cha *')}
                  <UnitPicker name="newParentParentId" label="Đơn vị cha mới trực thuộc" units={org.units} value={newParentParent} error={errors?.newParentParentId}
                    onChange={(v) => { setNewParentParent(v); guard.markDirty(); }}
                    specials={[]} />
                </div>
              </fieldset>
              <Textarea name="description" label="Mô tả" rows={3} maxLength={1000} placeholder="Mô tả chức năng của đơn vị" error={errors?.description} />
              <Field name="active" label="Trạng thái" error={errors?.active}><Seg name="active" items={[['true', 'Đang hoạt động'], ['false', 'Ngừng hoạt động']]} value="true" /></Field>
              <div className="actions form-actions"><button className="button" type="submit">Tạo đơn vị</button><ButtonLink to="/to-chuc" kind="secondary">Hủy</ButtonLink></div>
            </div>
          </form>
        </section>
        <UnitPlacement units={org.units} parentId={parentId} draft={draft} newParentParent={newParentParent} />
      </div>
    </>
  );
}

/** Cột phải trang Thêm đơn vị: xem trước vị trí đơn vị mới trong cơ cấu (cập nhật khi nhập). */
function UnitPlacement({ units, parentId, draft, newParentParent }: { units: UnitDto[]; parentId: string; draft: Record<string, string>; newParentParent: string }) {
  const active = units.filter((u) => u.active);
  const byId = (id: number) => units.find((u) => u.id === id);
  const chainOf = (id: number | null): UnitDto[] => { const out: UnitDto[] = []; let u = id != null ? byId(id) : undefined; while (u) { out.unshift(u); u = u.parentId != null ? byId(u.parentId) : undefined; } return out; };
  const name = (draft.name ?? '').trim() || 'Đơn vị mới', type = (draft.type ?? '').trim();
  type Node = { key: string; label: string; type: string; fresh?: boolean; current?: boolean };
  let chain: Node[] = [];
  let siblings: UnitDto[] = [];
  if (parentId === NEW_PARENT) {
    chain = [...(newParentParent !== NO_PARENT ? chainOf(Number(newParentParent)) : []).map((u) => ({ key: String(u.id), label: u.name, type: u.type })),
      { key: 'new-parent', label: (draft.newParentName ?? '').trim() || 'Đơn vị cha mới', type: (draft.newParentType ?? '').trim(), fresh: true }];
  } else if (parentId === NO_PARENT) {
    siblings = active.filter((u) => u.parentId == null);
  } else if (parentId) {
    chain = chainOf(Number(parentId)).map((u) => ({ key: String(u.id), label: u.name, type: u.type }));
    siblings = active.filter((u) => u.parentId === Number(parentId));
  }
  const depth = chain.length;
  return (
    <aside className="card form-aside" aria-label="Vị trí trong cơ cấu">
      <h2>Vị trí trong cơ cấu</h2>
      {!parentId ? <p className="muted small">Chọn đơn vị cha để xem đơn vị mới sẽ nằm ở đâu.</p> : (
        <ol className="placement">
          {chain.map((n, i) => <li key={n.key} style={{ ['--d' as string]: i }} className={n.fresh ? 'fresh' : ''}><span>{n.label}</span>{n.type ? <span className="unit-chip">{n.type}</span> : null}{n.fresh ? <span className="flag flag-blue">Mới</span> : null}</li>)}
          <li style={{ ['--d' as string]: depth }} className="fresh current"><span><strong>{name}</strong></span>{type ? <span className="unit-chip">{type}</span> : null}<span className="flag flag-blue">Đang tạo</span></li>
          {siblings.slice(0, 5).map((u) => <li key={u.id} style={{ ['--d' as string]: depth }} className="sibling"><span>{u.name}</span><span className="unit-chip">{u.type}</span></li>)}
          {siblings.length > 5 ? <li style={{ ['--d' as string]: depth }} className="sibling more"><span className="muted">+{siblings.length - 5} đơn vị cùng cấp</span></li> : null}
        </ol>
      )}
      <div className="aside-tips">
        <h3>Lưu ý</h3>
        <ul>
          <li>Mã đơn vị do hệ thống tự cấp sau khi lưu.</li>
          <li>Mọi đơn vị đều thuộc Khoa Công nghệ Thông tin; hệ thống không tạo thêm khoa khác.</li>
          <li>Chọn “Tạo đơn vị cha mới” để tạo cả đơn vị cha (ví dụ một Trung tâm) trong cùng một lần lưu.</li>
          <li>Sau khi tạo, thêm thành viên và chức vụ ở trang Cơ cấu tổ chức.</li>
        </ul>
      </div>
    </aside>
  );
}

// ===================== HỒ SƠ NHÂN SỰ =====================
export function ProfilePage() {
  const { org, session, isAdmin, reloadOrg } = useSession();
  const mobile = useIsMobile();
  const access = useAccess();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { ask, toast, showSecret } = useUi();
  const [busy, setBusy] = useState(false);
  useTitle('Hồ sơ nhân sự');
  const person = org.people.find((p) => p.id === Number(params.get('id')));
  if (!person || !session) return <><PageHeader title="Không tìm thấy hồ sơ" description="Người dùng không tồn tại hoặc đường dẫn không hợp lệ." /><ButtonLink to="/nhan-su">Về danh sách nhân sự</ButtonLink></>;
  const memberships = org.memberships.filter((m) => m.personId === person.id);
  const status = (m: MembershipDto) => (currentMembership(m) ? 'Đang tham gia' : m.start > today() ? 'Chưa bắt đầu' : 'Đã kết thúc');
  const unitName = (id: number) => org.units.find((u) => u.id === id)?.name ?? 'Chưa xác định';
  const roleName = (id: number) => org.roles.find((r) => r.id === id)?.name ?? 'Chưa xác định';
  const self = person.id === session.user.id;
  if (self && mobile) return <MyProfileMobile person={person} />;


  async function act(action: 'reset' | 'lock' | 'delete') {
    const [title, message, yes] = action === 'reset'
      ? ['Cấp lại mật khẩu?', `Mật khẩu hiện tại của ${person!.name} sẽ hết hiệu lực và mọi phiên đăng nhập của người này bị đăng xuất.`, 'Cấp lại']
      : action === 'lock'
        ? person!.active ? ['Khóa tài khoản?', `${person!.name} sẽ không đăng nhập được và bị đăng xuất ngay. Dữ liệu và lịch sử được giữ nguyên.`, 'Khóa'] : ['Mở khóa tài khoản?', `${person!.name} sẽ đăng nhập lại được bằng mật khẩu hiện có.`, 'Mở khóa']
        : ['Xóa tài khoản?', `Xóa hẳn ${person!.name} cùng các dòng thành viên đơn vị. Chỉ thực hiện được khi tài khoản chưa có lịch sử; không thể hoàn tác.`, 'Xóa'];
    if (!(await ask(message, title, yes))) return;
    setBusy(true);
    try {
      if (action === 'reset') {
        const r = await api<{ temporaryPassword: string }>('POST', `/api/nhan-su/${person!.id}/cap-lai-mat-khau`, {});
        showSecret('Mật khẩu tạm mới', `Gửi mật khẩu này cho ${person!.name} qua kênh riêng. Mật khẩu chỉ hiển thị một lần.`, r.temporaryPassword);
      } else if (action === 'lock') {
        await api('PUT', `/api/nhan-su/${person!.id}/trang-thai`, { active: !person!.active });
        await reloadOrg();
        toast(person!.active ? `Đã khóa tài khoản ${person!.name}.` : `Đã mở khóa tài khoản ${person!.name}.`);
      } else {
        await api('DELETE', `/api/nhan-su/${person!.id}`);
        await reloadOrg();
        navigate('/nhan-su');
        toast(`Đã xóa tài khoản ${person!.name}.`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) showSecret('Không thực hiện được', e.message, '');
      else toast((e as Error).message, true);
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Hồ sơ nhân sự" description="Thông tin cá nhân và các đơn vị đang tham gia." />
      <section className="card profile-card">
        <div className="profile-summary">
          <Avatar initials={person.initials} tone={person.id - 1} />
          <div><h2>{person.name}</h2><p>{person.email} · {person.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}</p><div className="contact-detail">{person.employeeCode}{person.phone ? ' · ' + person.phone : ''}</div></div>
        </div>
        <div className="metadata academic">
          {([['Học hàm', person.academicTitle || 'Chưa có'], ['Học vị', person.degree], ['Tình trạng đào tạo', person.training || 'Chưa cập nhật'], ['Quản trị hệ thống', person.isSystemAdmin ? 'Có' : 'Không']] as [string, string][])
            .map(([k, v]) => <dl key={k}><dt>{k}</dt><dd>{v}</dd></dl>)}
        </div>
        <hr className="separator" />
        <h3>Đơn vị và chức vụ</h3>
        {memberships.length ? (
          <div className="table-wrap">
            <table className="profile-table m-cards" aria-label="Đơn vị tham gia">
              <thead><tr><th>Đơn vị</th><th>Chức vụ</th><th>Đơn vị chính</th><th>Trạng thái</th></tr></thead>
              <tbody>{memberships.map((m, i) => (
                <tr key={i}>
                  <td>{access.hasManageScope ? <Link to={`/to-chuc?unit=${m.unitId}`}><strong>{unitName(m.unitId)}</strong></Link> : <strong>{unitName(m.unitId)}</strong>}<small className="muted" style={{ display: 'block', marginTop: 4 }}>{ymdText(m.start)} — {m.end ? ymdText(m.end) : 'Hiện tại'}</small></td>
                  <td data-label="Chức vụ">{roleName(m.roleId)}</td><td data-label="Đơn vị chính">{m.primary ? 'Có' : 'Không'}</td><td data-label="Trạng thái">{status(m)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty title="Chưa tham gia đơn vị" description="Gán người dùng vào đơn vị để bắt đầu." />}
        {isAdmin ? (
          <section className="account-admin" aria-labelledby="account-admin-title">
            <h3 id="account-admin-title">Quản lý tài khoản</h3>
            <div className="actions wrap">
              <ButtonLink to={`/sua-nhan-su?id=${person.id}`} kind="secondary">Chỉnh sửa thông tin</ButtonLink>
              {!self ? <>
                <button type="button" className="button secondary" disabled={busy} onClick={() => void act('reset')}>Cấp lại mật khẩu</button>
                <button type="button" className="button secondary" disabled={busy} onClick={() => void act('lock')}>{person.active ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}</button>
                <button type="button" className="button danger" disabled={busy} onClick={() => void act('delete')}>Xóa tài khoản</button>
              </> : null}
            </div>
          </section>
        ) : null}
        <div className="actions">
          {person.active && (session.capabilities.manageableUnitIds.length ?? 0) > 0 ? <ButtonLink to={`/them-thanh-vien?person=${person.id}`}>+ Thêm vào đơn vị</ButtonLink> : null}
          {access.hasManageScope ? <ButtonLink to="/nhan-su" kind="secondary">Về danh sách nhân sự</ButtonLink> : <ButtonLink to="/" kind="secondary">Về trang chính</ButtonLink>}
        </div>
      </section>
    </>
  );
}

// ===================== THÊM / SỬA NHÂN SỰ =====================
/** Gợi ý [giá trị lưu, mô tả]. Giữ cách viết tắt đang có trong dữ liệu (PGS, NCS) để thống kê không bị tách. */
const DEGREES: ComboOption[] = [['Cử nhân', ''], ['Kỹ sư', ''], ['Thạc sĩ', ''], ['Tiến sĩ', '']];
const TITLES: ComboOption[] = [['PGS', 'Phó Giáo sư'], ['GS', 'Giáo sư']];
const TRAINING: ComboOption[] = [['NCS', 'Nghiên cứu sinh'], ['Cao học', 'Đang học thạc sĩ']];


export function PersonFormPage({ editing }: { editing: boolean }) {
  const { org, isAdmin, reloadOrg, refreshSession } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast, showSecret } = useUi();
  const guard = useDirtyGuard();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState('');
  const personId = editing ? Number(params.get('id')) : null;
  const person = personId ? org.people.find((p) => p.id === personId) : null;
  const [draft, setDraft] = useState<Record<string, string>>({});
  useTitle(editing ? 'Chỉnh sửa thông tin' : 'Thêm nhân sự');
  if (!isAdmin) return <><PageHeader title={editing ? 'Chỉnh sửa nhân sự' : 'Thêm nhân sự'} description="Chỉ quản trị hệ thống được quản lý tài khoản nhân sự." /><div className="card card-pad"><ButtonLink to="/nhan-su" kind="secondary">Về danh sách nhân sự</ButtonLink></div></>;
  if (editing && !person) return <><PageHeader title="Không tìm thấy hồ sơ" description="Người dùng không tồn tại hoặc đã bị xóa." /><ButtonLink to="/nhan-su">Về danh sách nhân sự</ButtonLink></>;
  const text = (name: string, label: string, value: string, list: ComboOption[] | null, attrs: Record<string, unknown> = {}) => (
    <Field name={name} label={label} error={errors?.[name]}>
      {list ? <Combobox name={name} label={label} defaultValue={value} options={list} invalid={!!errors?.[name]} placeholder={attrs.placeholder as string | undefined} maxLength={attrs.maxLength as number | undefined} />
        : <input id={name} name={name} type="text" defaultValue={value} aria-describedby={`${name}-error`} aria-invalid={errors?.[name] ? true : undefined} {...attrs} />}
    </Field>
  );
  const cancel = editing ? `/ho-so?id=${personId}` : '/nhan-su';
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setMessage('');
    const local = personErrors(org, v, personId);
    if (Object.keys(local).length) { setErrors(local); return; }
    try {
      if (!editing) {
        const r = await send<CreatedPersonDto>('POST', '/api/nhan-su', personBody(v));
        if (r.errors) { setErrors(r.errors); return; }
        guard.markClean(); await reloadOrg();
        navigate(`/ho-so?id=${r.value.person.id}`);
        showSecret('Đã thêm nhân sự', `Tài khoản ${r.value.person.email} đã được tạo. Gửi mật khẩu tạm cho ${r.value.person.name} qua kênh riêng; mật khẩu chỉ hiển thị một lần.`, r.value.temporaryPassword);
      } else {
        const { active: _a, ...rest } = v;
        const r = await send<PersonDto>('PUT', `/api/nhan-su/${personId}`, personBody(rest));
        if (r.errors) { setErrors(r.errors); return; }
        guard.markClean(); await reloadOrg(); await refreshSession();
        navigate(`/ho-so?id=${personId}`);
        toast('Đã lưu thông tin nhân sự.');
      }
    } catch (err) { setMessage((err as Error).message); }
  }
  return (
    <>
      <PageHeader title={editing ? 'Chỉnh sửa thông tin' : 'Thêm nhân sự'} description={editing ? 'Cập nhật hồ sơ, học hàm/học vị và quyền quản trị của người dùng.' : 'Tạo hồ sơ và tài khoản đăng nhập cho giảng viên, cán bộ.'} />
      <div className="form-layout">
        <section className="card form-card">
          <form id="person-form" noValidate onSubmit={submit} onInput={(e) => { guard.markDirty(); setDraft(formValues(e.currentTarget)); }}>
            <ErrorSummary errors={errors} message={message} />
            <div className="form-body">
              <fieldset className="form-section">
                <legend>Thông tin cá nhân</legend>
                <div className="two-col">
                  {text('name', 'Họ và tên *', person?.name ?? '', null, { required: true, maxLength: 150, autoComplete: 'off', placeholder: 'Ví dụ: Nguyễn Văn An' })}
                  <Input name="phone" label="Số điện thoại" type="tel" defaultValue={person?.phone ?? ''} maxLength={20} autoComplete="off" placeholder="Ví dụ: 0903 123 456" error={errors?.phone} />
                </div>
              </fieldset>
              <fieldset className="form-section">
                <legend>Tài khoản đăng nhập</legend>
                <Input name="email" label="Email đăng nhập *" type="email" defaultValue={person?.email ?? ''} required maxLength={254} autoComplete="off" placeholder="tennv@huit.edu.vn" error={errors?.email} />
                <div className="two-col">
                  <Field name="isSystemAdmin" label="Quản trị hệ thống" error={errors?.isSystemAdmin}><Seg name="isSystemAdmin" items={[['false', 'Không'], ['true', 'Có']]} value={String(person?.isSystemAdmin ?? false)} /></Field>
                  {editing ? null : <Field name="active" label="Trạng thái tài khoản" error={errors?.active}><Seg name="active" items={[['true', 'Đang hoạt động'], ['false', 'Khóa (chưa cho đăng nhập)']]} value="true" /></Field>}
                </div>
              </fieldset>
              <fieldset className="form-section">
                <legend>Học hàm, học vị</legend>
                <div className="three-col">
                  {text('degree', 'Học vị', person?.degree ?? '', DEGREES, { maxLength: 50, placeholder: 'Chọn hoặc nhập học vị' })}
                  {text('academicTitle', 'Học hàm', person?.academicTitle ?? '', TITLES, { maxLength: 50, placeholder: 'Để trống nếu chưa có' })}
                  {text('training', 'Tình trạng đào tạo', person?.training ?? '', TRAINING, { maxLength: 100, placeholder: 'Để trống nếu không đang học' })}
                </div>
              </fieldset>
              <div className="actions form-actions"><button className="button" type="submit">{editing ? 'Lưu thay đổi' : 'Thêm nhân sự'}</button><ButtonLink to={cancel} kind="secondary">Hủy</ButtonLink></div>
            </div>
          </form>
        </section>
        <PersonPreview people={org.people} personId={personId} editing={editing}
          draft={{ name: person?.name ?? '', email: person?.email ?? '', degree: person?.degree ?? '', academicTitle: person?.academicTitle ?? '', isSystemAdmin: String(person?.isSystemAdmin ?? false), active: String(person?.active ?? true), ...draft }} />
      </div>
    </>
  );
}

/** Cột phải trang Thêm/Sửa nhân sự: xem trước hồ sơ (cập nhật khi nhập) và các bước sau khi lưu. */
function PersonPreview({ draft, people, personId, editing }: { draft: Record<string, string>; people: PersonDto[]; personId: number | null; editing: boolean }) {
  const name = (draft.name ?? '').trim().replace(/\s+/g, ' ');
  const email = (draft.email ?? '').trim();
  const initials = name ? name.split(' ').slice(-2).map((w) => w[0]?.toUpperCase() ?? '').join('') : '?';
  const prefix = [draft.academicTitle, draft.degree].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
  const taken = !!email && people.some((p) => p.id !== Number(personId) && p.email.toLowerCase() === email.toLowerCase());
  const admin = draft.isSystemAdmin === 'true', active = draft.active !== 'false';
  return (
    <aside className="card form-aside" aria-label="Xem trước hồ sơ">
      <h2>Xem trước hồ sơ</h2>
      <div className="person-preview">
        <Avatar initials={initials} tone={name.length} />
        <div>
          <strong>{name || 'Họ và tên'}</strong>
          {prefix ? <small className="muted">{prefix}</small> : null}
          <small className={taken ? 'red' : 'muted'}>{email || 'email@huit.edu.vn'}</small>
        </div>
        <div className="person-preview-tags">
          <span className={`role-badge ${admin ? 'role-admin' : 'role-member'}`}>{admin ? 'Quản trị hệ thống' : 'Người dùng'}</span>
          {editing ? null : active ? <span className="st st-done"><i />Đang hoạt động</span> : <span className="st st-draft"><i />Đã khóa</span>}
        </div>
      </div>
      {taken ? <div className="notice warn">Email này đã được dùng cho tài khoản khác.</div> : null}
      <div className="aside-tips">
        <h3>{editing ? 'Lưu ý' : 'Sau khi thêm'}</h3>
        {editing ? (
          <ul>
            <li>Đổi email thì người dùng đăng nhập bằng email mới.</li>
            <li>Cấp lại mật khẩu, khóa hoặc mở khóa tài khoản ở trang Hồ sơ.</li>
            <li>Bật “Quản trị hệ thống” cho phép quản lý tài khoản, đơn vị và phân quyền.</li>
          </ul>
        ) : (
          <ol>
            <li>Hệ thống tạo <b>mật khẩu tạm</b> và chỉ hiện <b>một lần</b>.</li>
            <li>Gửi mật khẩu tạm cho người dùng qua kênh riêng; họ nên đổi ngay sau lần đăng nhập đầu.</li>
            <li>Thêm người dùng vào đơn vị và chức vụ ở trang <b>Cơ cấu tổ chức</b> để họ nhận được việc.</li>
          </ol>
        )}
      </div>
    </aside>
  );
}

// ===================== ĐỔI MẬT KHẨU =====================
export function PasswordPage() {
  const { session } = useSession();
  const { toast } = useUi();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState('');
  useTitle('Đổi mật khẩu');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = formValues(form);
    setMessage('');
    const local = passwordErrors(v);
    if (Object.keys(local).length) { setErrors(local); return; }
    try {
      const r = await send('POST', '/api/auth/doi-mat-khau', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      if (r.errors) { setErrors(r.errors); return; }
      form.reset(); setErrors(null);
      toast('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.');
    } catch (err) { setMessage((err as Error).message); }
  }
  return (
    <>
      <PageHeader title="Đổi mật khẩu" description="Đặt mật khẩu mới cho tài khoản của bạn. Các phiên đăng nhập khác sẽ bị đăng xuất." />
      <section className="card form-card narrow-form">
        <h2>{session?.user.email}</h2>
        <form id="password-form" noValidate onSubmit={submit}>
          <ErrorSummary errors={errors} message={message} />
          <div className="form-body">
            <Input name="currentPassword" label="Mật khẩu hiện tại *" type="password" autoComplete="current-password" required maxLength={256} error={errors?.currentPassword} />
            <Input name="newPassword" label="Mật khẩu mới * (từ 8 ký tự, có chữ và số)" type="password" autoComplete="new-password" required maxLength={128} error={errors?.newPassword} />
            <Input name="confirmPassword" label="Nhập lại mật khẩu mới *" type="password" autoComplete="new-password" required maxLength={128} error={errors?.confirmPassword} />
            <div className="actions form-actions"><button className="button" type="submit">Đổi mật khẩu</button><ButtonLink to="/" kind="secondary">Hủy</ButtonLink></div>
          </div>
        </form>
      </section>
    </>
  );
}

export function NotFoundPage() {
  useTitle('Không tìm thấy trang');
  return <><PageHeader title="Không tìm thấy trang" description="Đường dẫn này không tồn tại." /><div className="card not-found"><ButtonLink to="/">Về trang chính</ButtonLink></div></>;
}

export type { UnitDto };
