import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditRowDto, CategoryDto, NotificationDto, NotificationListDto, TemplateDto } from '@khoa/shared';
import { api, get, send } from '../api/client';
import { useSession } from '../session';
import { useAccess } from '../nav';
import { ButtonLink, Empty, ErrorSummary, Input, Loading, Modal, PRIORITY, PageHeader, RECURRENCE, Select, Textarea, useUi } from '../ui/ui';
import { addDaysIso, fmtDay, fmtTime, isoDay, todayIso, ymdText } from '../format';
import { useTitle } from '../pages/common';
import { NotiItem, useReadAll } from '../layout/Shell';
import { hashOf, useCategories, useTemplates } from './queries';
import { Failed } from './TaskDetail';

// ---------------- Thể loại ----------------
function CategoryDialog({ c, onClose }: { c?: CategoryDto; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const r = await send<CategoryDto>(c ? 'PUT' : 'POST', c ? `/api/the-loai/${c.id}` : '/api/the-loai', { name: fd.get('name'), description: fd.get('description'), active: fd.get('active') === 'true' });
      if (r.errors) { setErrors(r.errors); return; }
      onClose();
      void qc.invalidateQueries({ queryKey: ['categories'] });
      toast(c ? 'Đã lưu thể loại.' : `Đã thêm thể loại ${r.value.name}.`);
    } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <Modal title={c ? 'Sửa thể loại' : 'Thêm thể loại'} subtitle={c ? `${c.taskCount} công việc đang dùng` : ''} onClose={onClose}>
      <form id="category-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <Input name="name" label="Tên thể loại *" defaultValue={c?.name ?? ''} maxLength={100} required error={errors?.name} />
        <Textarea name="description" label="Mô tả" defaultValue={c?.description ?? ''} rows={2} maxLength={500} error={errors?.description} />
        <label className="check"><input type="checkbox" name="active" value="true" defaultChecked={!c || c.active} /> Đang dùng (bỏ chọn để ngừng dùng cho công việc mới)</label>
        <div className="actions form-actions"><button type="button" className="button secondary" onClick={onClose}>Hủy</button><button className="button" type="submit">Lưu</button></div>
      </form>
    </Modal>
  );
}

export function CategoriesPage() {
  const q = useCategories();
  const [dialog, setDialog] = useState<{ c?: CategoryDto } | null>(null);
  useTitle('Thể loại công việc');
  return (
    <>
      <PageHeader title="Thể loại công việc" description="Mỗi công việc chọn một thể loại. Ngừng dùng thể loại thay vì xóa để giữ lịch sử." action={<button className="button" onClick={() => setDialog({})}>+ Thêm thể loại</button>} />
      {!q.data ? (q.error ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : <Loading />) : (
        <div className="card table-card"><div className="table-wrap"><table>
          <thead><tr><th>Tên thể loại</th><th>Mô tả</th><th>Số công việc</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{q.data.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong></td><td className="muted">{c.description || '—'}</td><td>{c.taskCount}</td>
              <td>{c.active ? <span className="st st-done"><i />Đang dùng</span> : <span className="st st-draft"><i />Ngừng dùng</span>}</td>
              <td className="row-actions"><button className="button small secondary" onClick={() => setDialog({ c })}>Sửa</button></td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
      {dialog ? <CategoryDialog c={dialog.c} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

// ---------------- Mẫu công việc ----------------
function TemplateDialog({ t, onClose }: { t?: TemplateDto; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const { org, isAdmin } = useSession();
  const access = useAccess();
  const cats = useCategories().data ?? [];
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const unitIds = isAdmin ? org.units.map((u) => u.id) : [...new Set([...access.caps.createUnitIds, ...(t ? [t.unitId] : [])])];
  const unitName = (id: number) => org.units.find((u) => u.id === id)?.name ?? `Đơn vị ${id}`;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? '');
    const body = {
      name: v('name'), title: v('title'), description: v('description'), criteria: v('criteria'), categoryId: v('categoryId') ? Number(v('categoryId')) : null,
      priority: Number(v('priority') || 2), unitId: v('unitId') ? Number(v('unitId')) : null, durationDays: Number(v('durationDays') || 0),
      recurrence: Number(v('recurrence') || 0), nextRun: v('nextRun') || null, active: fd.get('active') === 'true',
    };
    if (body.recurrence > 0 && !body.nextRun) { setErrors({ nextRun: 'Chọn ngày tạo lần tới cho việc lặp lại.' }); return; }
    try {
      const r = await send<TemplateDto>(t ? 'PUT' : 'POST', t ? `/api/mau-cong-viec/${t.id}` : '/api/mau-cong-viec', body);
      if (r.errors) { setErrors(r.errors); return; }
      onClose();
      void qc.invalidateQueries({ queryKey: ['templates'] });
      toast('Đã lưu mẫu công việc.');
    } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <Modal title={t ? 'Sửa mẫu công việc' : 'Thêm mẫu công việc'} subtitle={t ? `Đã dùng ${t.timesUsed} lần` : ''} wide onClose={onClose}>
      <form id="template-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="form-grid two">
          <Input name="name" label="Tên mẫu *" defaultValue={t?.name ?? ''} maxLength={150} required error={errors?.name} />
          <Input name="title" label="Tiêu đề công việc *" defaultValue={t?.title ?? ''} maxLength={250} required error={errors?.title} />
        </div>
        <Textarea name="description" label="Mô tả" defaultValue={t?.description ?? ''} rows={2} maxLength={10000} error={errors?.description} />
        <Textarea name="criteria" label="Tiêu chí hoàn thành" defaultValue={t?.criteria ?? ''} rows={2} maxLength={4000} error={errors?.criteria} />
        <div className="form-grid two">
          <Select name="categoryId" label="Thể loại" options={cats.filter((c) => c.active || c.id === t?.categoryId).map((c) => [c.id, c.name])} placeholder="Chưa chọn" defaultValue={t?.categoryId ?? ''} error={errors?.categoryId} />
          <Select name="priority" label="Ưu tiên" options={Object.entries(PRIORITY).map(([k, [l]]) => [k, l])} defaultValue={t?.priority ?? 2} error={errors?.priority} />
          <Select name="unitId" label="Đơn vị quản lý *" options={unitIds.map((u) => [u, unitName(u)] as [number, string]).sort((a, b) => a[1].localeCompare(b[1], 'vi'))} placeholder="Chọn đơn vị" defaultValue={t?.unitId ?? ''} error={errors?.unitId} />
          <Input name="durationDays" label="Số ngày thực hiện *" type="number" defaultValue={t?.durationDays ?? 14} min={1} max={365} error={errors?.durationDays} />
          <Select name="recurrence" label="Lặp lại" options={Object.entries(RECURRENCE)} defaultValue={t?.recurrence ?? 0} error={errors?.recurrence} />
          <Input name="nextRun" label="Ngày tạo lần tới" type="date" defaultValue={t?.nextRun ?? ''} error={errors?.nextRun} />
        </div>
        <label className="check"><input type="checkbox" name="active" value="true" defaultChecked={!t || t.active} /> Đang dùng</label>
        <div className="actions form-actions"><button type="button" className="button secondary" onClick={onClose}>Hủy</button><button className="button" type="submit">Lưu mẫu</button></div>
      </form>
    </Modal>
  );
}

export function TemplatesPage() {
  const q = useTemplates();
  const access = useAccess();
  const [dialog, setDialog] = useState<{ t?: TemplateDto } | null>(null);
  const qc = useQueryClient();
  const { ask, toast } = useUi();
  useTitle('Mẫu công việc');
  async function remove(t: TemplateDto) {
    const used = t.timesUsed ? ` Mẫu đã dùng ${t.timesUsed} lần; các công việc đã tạo từ mẫu vẫn được giữ nguyên.` : '';
    const repeat = t.recurrence ? ' Việc lặp lại theo mẫu này sẽ không được tạo nữa.' : '';
    if (!(await ask(`Xóa mẫu “${t.name}”? Không hoàn tác được.${used}${repeat}`, 'Xóa mẫu công việc?', 'Xóa mẫu'))) return;
    try {
      const r = await api<{ unlinkedTasks: number }>('DELETE', `/api/mau-cong-viec/${t.id}`);
      void qc.invalidateQueries({ queryKey: ['templates'] });
      toast(`Đã xóa mẫu “${t.name}”.${r.unlinkedTasks ? ` ${r.unlinkedTasks} công việc đã tạo từ mẫu vẫn được giữ.` : ''}`);
    } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <>
      <PageHeader title="Mẫu công việc" description="Mẫu điền sẵn nội dung khi tạo việc; mẫu lặp lại tự tạo bản nháp mỗi học kỳ/năm học và nhắc người tạo xác nhận."
        action={access.canCreate || access.isAdmin ? <button className="button" onClick={() => setDialog({})}>+ Thêm mẫu</button> : undefined} />
      {!q.data ? (q.error ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : <Loading />) : (
        <div className="card table-card">
          {q.data.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Mẫu</th><th>Đơn vị</th><th>Lặp lại</th><th>Lần tới</th><th>Đã dùng</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>{q.data.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong><small className="muted">{t.categoryName || 'Chưa phân loại'} · {t.durationDays} ngày · {PRIORITY[t.priority]?.[0]}</small></td>
                  <td>{t.unitName}</td><td>{RECURRENCE[t.recurrence]}</td><td>{t.nextRun ? ymdText(t.nextRun) : '—'}</td><td>{t.timesUsed}</td>
                  <td>{t.active ? <span className="st st-done"><i />Đang dùng</span> : <span className="st st-draft"><i />Ngừng dùng</span>}</td>
                  <td className="row-actions">
                    {t.active && access.canCreate ? <ButtonLink to={`/cong-viec/tao?template=${t.id}`} kind="small">Dùng mẫu</ButtonLink> : null}
                    {t.canEdit ? <button className="button small secondary" onClick={() => setDialog({ t })}>Sửa</button> : null}
                    {t.canEdit ? <button className="button small ghost danger-text" onClick={() => void remove(t)}>Xóa</button> : null}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="Chưa có mẫu" description="Thêm mẫu cho các việc lặp lại như ra đề thi, cập nhật đề cương, báo cáo NCKH." />}
        </div>
      )}
      {dialog ? <TemplateDialog t={dialog.t} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

// ---------------- Nhật ký hệ thống ----------------
export function AuditPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const data = useQuery({ queryKey: ['audit', q], queryFn: () => get<AuditRowDto[]>(`/api/nhat-ky?limit=300${q ? '&q=' + encodeURIComponent(q) : ''}`), staleTime: 5_000 });
  useTitle('Nhật ký hệ thống');
  return (
    <>
      <PageHeader title="Nhật ký hệ thống" description="Thao tác quản trị: tài khoản, cơ cấu tổ chức, chức vụ, thể loại. Không lưu mật khẩu." />
      <form className="task-filters" id="audit-search" onSubmit={(e) => { e.preventDefault(); navigate(hashOf('/nhat-ky', { q: text })); }}>
        <input type="search" name="q" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm theo hành động, người thao tác, đối tượng…" aria-label="Tìm trong nhật ký" />
        <button className="button secondary" type="submit">Tìm</button>
      </form>
      {!data.data ? (data.error ? <Failed error={data.error} onRetry={() => void data.refetch()} /> : <Loading />) : (
        <div className="card table-card"><div className="table-wrap"><table>
          <thead><tr><th>Thời gian</th><th>Người thao tác</th><th>Hành động</th><th>Đối tượng</th><th>IP</th></tr></thead>
          <tbody>{data.data.length ? data.data.map((r) => (
            <tr key={r.id}><td className="nowrap">{fmtDay(r.at)} {fmtTime(r.at)}</td><td>{r.actor}</td><td><b>{r.action}</b></td><td>{r.objectType} {r.objectId}</td><td className="muted small">{r.ip}</td></tr>
          )) : <tr><td colSpan={5} className="muted">Không có bản ghi.</td></tr>}</tbody>
        </table></div></div>
      )}
    </>
  );
}

// ---------------- Thông báo ----------------
/** Chia thông báo theo ngày nhận: Hôm nay / Hôm qua / Trước đó (giữ thứ tự mới nhất trước). */
function notiDays(items: NotificationDto[]): [string, NotificationDto[]][] {
  const today = todayIso(), yesterday = addDaysIso(today, -1);
  const groups: [string, NotificationDto[]][] = [['Hôm nay', []], ['Hôm qua', []], ['Trước đó', []]];
  items.forEach((n) => { const d = isoDay(n.createdAt); groups[d === today ? 0 : d === yesterday ? 1 : 2][1].push(n); });
  return groups.filter(([, list]) => list.length);
}

export function NotificationsPage() {
  const q = useQuery({ queryKey: ['notif-all'], queryFn: () => get<NotificationListDto>('/api/thong-bao?limit=100'), staleTime: 20_000 });
  const readAll = useReadAll();
  useTitle('Thông báo');
  return (
    <>
      <PageHeader title="Thông báo" description="Giao việc, kết quả, gia hạn, nhắc hạn và bình luận liên quan đến bạn." action={q.data?.unread ? <button className="button secondary" onClick={() => void readAll()}>Đánh dấu tất cả đã đọc</button> : undefined} />
      {!q.data ? (q.error ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : <Loading />) : (
        q.data.items.length ? (
          <div className="noti-days">
            {notiDays(q.data.items).map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h2 className="noti-day">{label}</h2>
                <div className="card noti-page">{list.map((n) => <NotiItem key={n.id} n={n} compact={false} />)}</div>
              </section>
            ))}
          </div>
        ) : <div className="card noti-page"><Empty title="Chưa có thông báo" description="Thông báo mới sẽ hiện ở đây và ở biểu tượng chuông." /></div>
      )}
    </>
  );
}
