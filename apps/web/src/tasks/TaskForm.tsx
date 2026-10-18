import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { send } from '../api/client';
import { useSession } from '../session';
import { useAccess } from '../nav';
import { Badge, ButtonLink, Empty, ErrorSummary, Field, Input, Loading, Modal, PRIORITY, RECURRENCE, STATUS, Seg, Select, Textarea, useUi } from '../ui/ui';
import { addDaysIso, fmtDay, isoDay, normalize, todayIso, ymdText } from '../format';
import { useDirtyGuard, useTitle } from '../pages/common';
import { useCategories, useTaskDetail, useTaskList, useTemplates } from './queries';
import { Failed } from './TaskDetail';

function TemplatePicker({ onClose }: { onClose: () => void }) {
  const q = useTemplates();
  const list = (q.data ?? []).filter((t) => t.active);
  return (
    <Modal title="Tạo từ mẫu" subtitle="Dùng cho việc lặp lại mỗi học kỳ hoặc mỗi năm học" onClose={onClose}>
      {!q.data ? <Loading /> : list.length ? (
        <>
          <div className="template-pick">
            {list.map((t) => (
              <Link key={t.id} className="template-item" to={`/cong-viec/tao?template=${t.id}`} onClick={onClose}>
                <div><strong>{t.name}</strong><small className="muted">{t.categoryName || 'Chưa phân loại'} · {RECURRENCE[t.recurrence]}{t.recurrence ? ' · lần tới ' + (t.nextRun ? ymdText(t.nextRun) : '') : ''} · {t.durationDays} ngày</small></div>
                <span className="muted small">Đã dùng {t.timesUsed} lần</span>
              </Link>
            ))}
          </div>
          <p className="muted small">Mẫu điền sẵn tiêu đề, mô tả, tiêu chí, thể loại, ưu tiên, đơn vị; hạn tự tính theo số ngày thực hiện.</p>
          <div className="actions"><ButtonLink to="/mau-cong-viec" kind="secondary">Quản lý mẫu</ButtonLink></div>
        </>
      ) : <Empty title="Chưa có mẫu" description="Tích “Lưu làm mẫu” khi tạo công việc, hoặc vào Mẫu công việc để thêm." />}
    </Modal>
  );
}

type DepOption = { id: number; title: string; status: number; unitName: string; due: string | null };

/** "Phải xong trước": danh sách tick có tìm kiếm; giá trị gửi qua các input ẩn name="dependsOn". */
function DependsPicker({ options, initial, error }: { options: DepOption[]; initial: number[]; error?: string }) {
  const [picked, setPicked] = useState<number[]>(initial);
  const [query, setQuery] = useState('');
  const q = normalize(query);
  const shown = options.filter((o) => !q || normalize(`${o.title} ${o.unitName}`).includes(q));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const byId = new Map(options.map((o) => [o.id, o]));
  return (
    <Field name="dependsOn" label="Phải xong trước" help="Người nhận chỉ bắt đầu được khi các việc đã chọn hoàn thành." error={error}>
      {picked.map((id) => <input key={id} type="hidden" name="dependsOn" value={id} />)}
      {picked.length ? (
        <div className="dep-chips">
          {picked.map((id) => (
            <span key={id} className="dep-chip">
              <span>{byId.get(id)?.title ?? `Công việc #${id}`}</span>
              <button type="button" aria-label={`Bỏ chọn ${byId.get(id)?.title ?? id}`} onClick={() => toggle(id)}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      <input id="dependsOn" type="search" placeholder="Tìm công việc theo tên hoặc đơn vị…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby="dependsOn-error dependsOn-help" />
      <div className="pick-list dep-list" role="group" aria-label="Công việc phải xong trước">
        {shown.length ? shown.map((o) => (
          <label key={o.id} className="pick-item dep-item">
            <input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
            <span>
              <strong title={o.title}>{o.title}</strong>
              <small className="muted"><Badge map={STATUS} value={o.status} />{o.unitName}{o.due ? ` · hạn ${fmtDay(o.due)}` : ''}</small>
            </span>
          </label>
        )) : <p className="muted small dep-empty">{options.length ? 'Không có công việc phù hợp.' : 'Chưa có công việc nào để chọn.'}</p>}
      </div>
    </Field>
  );
}

export function TaskFormPage({ editing }: { editing: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useUi();
  const { org } = useSession();
  const access = useAccess();
  const guard = useDirtyGuard();
  const id = Number(params.get('id')) || 0;
  const templateId = Number(params.get('template')) || 0;
  const detail = useTaskDetail(id, editing);
  const templates = useTemplates(!editing && templateId > 0);
  const cats = useCategories().data ?? [];
  const pool = useTaskList(access.isAdmin || access.viewUnitIds.length ? 'all' : 'created');
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState('');
  const [picker, setPicker] = useState(false);
  const [recurrence, setRecurrence] = useState('0');
  useTitle(editing ? 'Sửa công việc' : 'Tạo công việc');

  if (editing) {
    if (!detail.data && detail.error) return <Failed page error={detail.error} onRetry={() => void detail.refetch()} />;
    if (!detail.data) return <Loading />;
    if (!detail.data.permissions.canEdit) return <Failed page error={{ status: 403, message: 'Bạn không có quyền sửa công việc này.' }} />;
  } else if (templateId && !templates.data) {
    return templates.error ? <Failed page error={templates.error} /> : <Loading />;
  }
  const d = detail.data;
  const tpl = templates.data?.find((x) => x.id === templateId);
  const source = d
    ? { title: d.summary.title, description: d.description, criteria: d.criteria, categoryId: d.summary.categoryId, priority: d.summary.priority, start: isoDay(d.summary.start), due: isoDay(d.summary.due), unitId: d.summary.unitId, parentId: d.summary.parentId, dependsOn: d.dependsOn.map((x) => x.id) }
    : tpl
      ? { title: tpl.title, description: tpl.description, criteria: tpl.criteria, categoryId: tpl.categoryId, priority: tpl.priority, start: todayIso(), due: addDaysIso(todayIso(), tpl.durationDays), unitId: tpl.unitId, parentId: null, dependsOn: [] as number[] }
      : { title: '', description: '', criteria: '', categoryId: null, priority: 2, start: '', due: '', unitId: null as number | null, parentId: null, dependsOn: [] as number[] };
  const unitName = (u: number) => org.units.find((x) => x.id === u)?.name ?? `Đơn vị ${u}`;
  const unitIds = editing ? [...new Set([...access.caps.createUnitIds, ...access.caps.assignUnitIds, Number(source.unitId)])] : access.caps.createUnitIds;
  const unitOptions = unitIds.map((u) => [u, unitName(u)] as [number, string]).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const poolTasks = (pool.data?.items ?? []).filter((t) => t.id !== id && ![0, 6].includes(t.status));
  const taskOptions = poolTasks.map((t) => [t.id, `${t.title} (${STATUS[t.status][0]})`] as [number, string]);
  const depOptions: DepOption[] = poolTasks.map((t) => ({ id: t.id, title: t.title, status: t.status, unitName: t.unitName, due: t.due }));
  const isDraft = d?.summary.status === 0;
  const backTo = editing ? `/cong-viec/chi-tiet?id=${id}` : '/cong-viec';

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode = editing ? (isDraft ? 'draft' : 'save') : submitter?.value || 'create';
    const fd = new FormData(form);
    const v = (k: string) => String(fd.get(k) ?? '');
    const rec = Number(v('recurrence') || 0);
    const body = {
      title: v('title').trim(), description: v('description'), criteria: v('criteria'), categoryId: v('categoryId') ? Number(v('categoryId')) : null,
      priority: Number(v('priority') || 2), start: v('start') || null, due: v('due') || null, unitId: v('unitId') ? Number(v('unitId')) : null,
      parentId: v('parentId') ? Number(v('parentId')) : null, dependsOn: fd.getAll('dependsOn').map(Number),
      draft: mode === 'draft', templateId: tpl?.id ?? null, recurrence: rec, saveAsTemplate: fd.get('saveAsTemplate') === 'true' || rec > 0,
    };
    const local: Record<string, string> = {};
    if (!body.title) local.title = 'Chưa nhập tiêu đề công việc.';
    else if (body.title.length > 250) local.title = 'Tiêu đề tối đa 250 ký tự.';
    if (!body.draft) {
      if (!body.categoryId) local.categoryId = 'Chưa chọn thể loại công việc.';
      if (!body.due) local.due = 'Chưa nhập hạn hoàn thành.';
      else if (!editing && body.due < todayIso()) local.due = 'Hạn hoàn thành đã qua. Chọn từ hôm nay trở đi.';
    }
    if (body.start && body.due && body.due < body.start) local.due = 'Hạn hoàn thành phải từ ngày bắt đầu trở đi.';
    if (!body.unitId) local.unitId = 'Chưa chọn đơn vị quản lý.';
    setMessage('');
    if (Object.keys(local).length) { setErrors(local); return; }
    try {
      const r = editing ? await send<{ id: number }>('PUT', `/api/cong-viec/${id}`, body) : await send<{ id: number }>('POST', '/api/cong-viec', body);
      if (r.errors) { setErrors(r.errors); return; }
      guard.markClean();
      void qc.invalidateQueries({ queryKey: ['list'] });
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      if (editing) void qc.invalidateQueries({ queryKey: ['detail', id] });
      navigate(`/cong-viec/chi-tiet?id=${r.value.id}${editing ? '' : '&tab=assign'}`);
      toast(editing ? 'Đã lưu thay đổi.' : body.draft ? 'Đã lưu nháp. Chỉ bạn nhìn thấy bản nháp này.' : 'Đã tạo công việc. Giao việc cho người thực hiện ngay bên dưới.');
    } catch (err) { setMessage((err as Error).message); }
  }

  return (
    <>
      <div className="detail-head">
        <Link className="back-link" to={backTo}>‹ {editing ? 'Chi tiết công việc' : 'Công việc'}</Link>
        <div className="detail-title">
          <div><h1 tabIndex={-1} id="page-title">{editing ? 'Sửa công việc' : 'Tạo công việc'}</h1><p className="muted">{editing ? 'Thay đổi được ghi vào lịch sử công việc.' : 'Lưu nháp khi chưa đủ thông tin; công việc chỉ hiện với người nhận sau khi tạo chính thức và giao việc.'}</p></div>
          {editing ? null : <button type="button" className="button secondary" onClick={() => setPicker(true)}>Tạo từ mẫu…</button>}
        </div>
      </div>
      <section className="card form-card task-form-card">
        <form id="task-form" noValidate onSubmit={submit} onInput={guard.markDirty} key={`${id}-${templateId}`}>
          <ErrorSummary errors={errors} message={message} />
          {tpl ? <div className="notice">Đang dùng mẫu “{tpl.name}”. Bạn vẫn sửa được mọi thông tin.</div> : null}
          <h2>Thông tin chung</h2>
          <div className="form-grid two">
            <div className="span-2"><Input name="title" label="Tiêu đề *" defaultValue={source.title} required maxLength={250} autoComplete="off" error={errors?.title} /></div>
            <div className="span-2"><Textarea name="description" label="Mô tả" defaultValue={source.description} rows={3} maxLength={10000} error={errors?.description} /></div>
            <div className="span-2"><Textarea name="criteria" label="Tiêu chí hoàn thành" defaultValue={source.criteria} rows={2} maxLength={4000} placeholder="Ví dụ: đề cương được bộ môn thông qua, nộp bản PDF có chữ ký" error={errors?.criteria} /></div>
            <Select name="categoryId" label="Thể loại *" options={cats.filter((c) => c.active || c.id === source.categoryId).map((c) => [c.id, c.name])} placeholder="Chọn thể loại" defaultValue={source.categoryId ?? ''} error={errors?.categoryId} />
            <Field name="priority" label="Mức ưu tiên"><Seg name="priority" items={Object.entries(PRIORITY).map(([k, [l]]) => [k, l])} value={source.priority} /></Field>
            <Input name="start" label="Ngày bắt đầu" type="date" defaultValue={source.start} error={errors?.start} />
            <Input name="due" label="Hạn hoàn thành *" type="date" defaultValue={source.due} min={editing ? undefined : todayIso()} error={errors?.due} />
            <Select name="unitId" label="Đơn vị quản lý *" options={unitOptions} placeholder="Chọn đơn vị" defaultValue={source.unitId ?? (unitOptions.length === 1 ? unitOptions[0][0] : '')} error={errors?.unitId} />
            <Select name="parentId" label="Công việc cha" options={taskOptions} placeholder="Không có" defaultValue={source.parentId ?? ''} error={errors?.parentId} />
          </div>
          <h2>Thêm (không bắt buộc)</h2>
          <div className="form-grid two">
            <DependsPicker options={depOptions} initial={source.dependsOn} error={errors?.dependsOn} />
            {editing ? null : (
              <div className="stack-sm">
                <Field name="recurrence" label="Lặp lại" help="Chọn lặp lại thì công việc được lưu làm mẫu; đến kỳ hệ thống tạo bản nháp và nhắc bạn xác nhận.">
                  <Seg name="recurrence" items={Object.entries(RECURRENCE).map(([k, l]) => [k, l])} value={recurrence} onChange={setRecurrence} />
                </Field>
                <label className="check"><input type="checkbox" name="saveAsTemplate" value="true" /> Lưu làm mẫu để lần sau tạo nhanh</label>
              </div>
            )}
          </div>
          <div className="actions form-actions">
            {editing ? <button className="button" type="submit" name="mode" value="save">Lưu thay đổi</button>
              : <><button className="button" type="submit" name="mode" value="create">Tạo công việc</button><button className="button secondary" type="submit" name="mode" value="draft">Lưu nháp</button></>}
            <ButtonLink to={backTo} kind="secondary">Hủy</ButtonLink>
          </div>
        </form>
      </section>
      {picker ? <TemplatePicker onClose={() => setPicker(false)} /> : null}
    </>
  );
}
