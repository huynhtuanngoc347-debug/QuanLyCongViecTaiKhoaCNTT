import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Search, UsersRound } from 'lucide-react';
import type { AssignOptionsDto, CategoryDto, OrganizationDto } from '@khoa/shared';
import { get, send } from '../api';
import { useSession } from '../session';
import { Avatar, FieldError, PageHeader, PRIORITY, StateView, button, buttonGhost, field, useAfterChange, useUi } from '../ui';
import { addDays, normalize, todayIso } from '../format';

/** Bước 2 sau khi tạo: chọn người thực hiện (có thể để sau). */
function AssignStep({ taskId, title }: { taskId: number; title: string }) {
  const navigate = useNavigate();
  const { notify } = useUi();
  const after = useAfterChange();
  const [opts, setOpts] = useState<AssignOptionsDto | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [lead, setLead] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<AssignOptionsDto>(`/api/cong-viec/lua-chon-giao-viec?taskId=${taskId}`).then(setOpts).catch((e) => notify((e as Error).message, true)); }, [taskId, notify]);
  const people = (opts?.people ?? []).filter((p) => !q || normalize(`${p.name} ${p.unitName}`).includes(normalize(q)));
  const toggle = (id: number) => { const n = new Set(picked); if (n.has(id)) { n.delete(id); if (lead === id) setLead(null); } else n.add(id); setPicked(n); };
  return (
    <>
      <PageHeader title="Giao cho ai?" subtitle={`“${title}” đã được tạo. Chọn người thực hiện, hoặc giao sau.`} />
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3.5 top-4 text-slate-400" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên hoặc bộ môn..." className={`${field} pl-10`} aria-label="Tìm người" />
      </div>
      {!opts ? <StateView kind="loading" title="Đang tải danh sách..." /> : (
        <div className="mb-28 overflow-hidden rounded-2xl border border-border bg-white">
          {people.length ? people.map((p) => {
            const on = picked.has(p.id);
            return (
              <div key={p.id} className={`flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 ${on ? 'bg-[#edf2ff]' : ''}`}>
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => toggle(p.id)} aria-pressed={on}>
                  <Avatar name={p.initials} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{p.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{p.unitName} · <span className={p.openTasks >= 5 ? 'font-semibold text-red-500' : ''}>{p.openTasks} việc đang mở</span></span>
                  </span>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-primary bg-primary text-white' : 'border-slate-300'}`}>{on ? <Check size={14} /> : null}</span>
                </button>
                {on ? <button onClick={() => setLead(lead === p.id ? null : p.id)} className={`min-h-9 shrink-0 rounded-lg px-2.5 text-[11px] font-bold ${lead === p.id ? 'bg-primary text-white' : 'bg-white text-primary ring-1 ring-blue-200'}`}>{lead === p.id ? 'Chủ trì' : 'Đặt chủ trì'}</button> : null}
              </div>
            );
          }) : <p className="p-4 text-[13px] text-slate-500">Không tìm thấy người phù hợp.</p>}
        </div>
      )}
      <div className="fixed bottom-24 left-1/2 z-20 flex w-[calc(100%-48px)] max-w-[392px] -translate-x-1/2 gap-3">
        <button className={buttonGhost} onClick={() => navigate(`/tasks/${taskId}`, { replace: true })}>Để sau</button>
        <button className={`${button} flex-1`} disabled={busy || !picked.size} onClick={async () => {
          setBusy(true);
          try {
            // Người chủ trì giao riêng với vai trò 1, những người còn lại phối hợp (vai trò 2).
            const others = [...picked].filter((id) => id !== lead);
            if (lead) { const r = await send('POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: [lead], unitId: null, role: 1, due: null, note: '' }); if (r.errors) { notify(Object.values(r.errors)[0], true); return; } }
            if (others.length) { const r = await send('POST', `/api/cong-viec/${taskId}/phan-cong`, { kind: 'person', personIds: others, unitId: null, role: lead ? 2 : null, due: null, note: '' }); if (r.errors) { notify(Object.values(r.errors)[0], true); return; } }
            after(taskId); notify(`Đã giao việc cho ${picked.size} người.`); navigate(`/tasks/${taskId}`, { replace: true });
          } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
        }}><UsersRound size={17} />Giao {picked.size ? `${picked.size} người` : 'việc'}</button>
      </div>
    </>
  );
}

export function CreatePage() {
  const { session, canCreate } = useSession();
  const { notify } = useUi();
  const after = useAfterChange();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<CategoryDto[]>('/api/the-loai'), staleTime: 300_000 });
  const org = useQuery({ queryKey: ['org'], queryFn: () => get<OrganizationDto>('/api/to-chuc'), staleTime: 300_000 });
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [priority, setPriority] = useState(2);
  const [created, setCreated] = useState<{ id: number; title: string } | null>(null);
  if (!canCreate) return <><PageHeader title="Tạo công việc" back /><StateView kind="error" title="Chưa có quyền tạo việc" text="Chức vụ của bạn chưa được phép tạo công việc. Liên hệ trưởng đơn vị nếu cần." action={<Link to="/" className={`${button} mx-auto w-fit`}>Về trang chủ</Link>} /></>;
  if (created) return <AssignStep taskId={created.id} title={created.title} />;
  const unitIds = session!.tasks.createUnitIds;
  const units = unitIds.map((id) => ({ id, name: org.data?.units.find((u) => u.id === id)?.name ?? `Đơn vị ${id}` }));
  return (
    <>
      <PageHeader title="Tạo công việc mới" back subtitle="Sau khi tạo, bạn chọn người thực hiện ngay ở bước tiếp theo." />
      <form noValidate className="space-y-5" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const v = (k: string) => String(fd.get(k) || '').trim();
        const body = {
          title: v('title'), description: v('description'), criteria: v('criteria'), categoryId: v('categoryId') ? Number(v('categoryId')) : null,
          priority, start: todayIso(), due: v('due') || null, unitId: v('unitId') ? Number(v('unitId')) : null, parentId: null, dependsOn: [], draft: false,
        };
        const errs: Record<string, string> = {};
        if (!body.title) errs.title = 'Nhập tên công việc.';
        if (!body.categoryId) errs.categoryId = 'Chọn thể loại.';
        if (!body.due) errs.due = 'Chọn hạn hoàn thành.';
        if (!body.unitId) errs.unitId = 'Chọn đơn vị quản lý.';
        if (Object.keys(errs).length) { setErrors(errs); return; }
        setBusy(true);
        try {
          const r = await send<{ id: number }>('POST', '/api/cong-viec', body);
          if (r.errors) { setErrors(r.errors); return; }
          after(); notify('Đã tạo công việc.'); setCreated({ id: r.value.id, title: body.title });
        } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
      }}>
        <label className="block text-xs font-bold">Tên công việc <span className="text-red-400">*</span>
          <input name="title" maxLength={250} placeholder="Ví dụ: Rà soát đề cương học phần" className={`${field} mt-2.5`} />
          <FieldError text={errors?.title} />
        </label>
        <label className="block text-xs font-bold">Mô tả
          <textarea name="description" rows={4} placeholder="Nội dung, yêu cầu và kết quả mong đợi..." className={`${field} mt-2.5 resize-none`} />
        </label>
        <label className="block text-xs font-bold">Tiêu chí hoàn thành
          <textarea name="criteria" rows={2} placeholder="Ví dụ: nộp bản PDF đã được bộ môn thông qua" className={`${field} mt-2.5 resize-none`} />
        </label>
        <label className="block text-xs font-bold">Thể loại <span className="text-red-400">*</span>
          <select name="categoryId" defaultValue="" className={`${field} mt-2.5`}>
            <option value="" disabled>Chọn thể loại</option>
            {(cats.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <FieldError text={errors?.categoryId} />
        </label>
        <label className="block text-xs font-bold">Đơn vị quản lý <span className="text-red-400">*</span>
          <select name="unitId" defaultValue={units.length === 1 ? units[0].id : ''} className={`${field} mt-2.5`}>
            {units.length > 1 ? <option value="" disabled>Chọn đơn vị</option> : null}
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <FieldError text={errors?.unitId} />
        </label>
        <label className="block text-xs font-bold">Hạn hoàn thành <span className="text-red-400">*</span>
          <input name="due" type="date" min={todayIso()} defaultValue={addDays(todayIso(), 7)} className={`${field} mt-2.5`} />
          <FieldError text={errors?.due} />
        </label>
        <div>
          <span className="text-xs font-bold">Mức độ ưu tiên</span>
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((p) => (
              <button type="button" key={p} onClick={() => setPriority(p)} className={`min-h-11 rounded-xl border text-[13px] font-bold transition ${priority === p ? (p >= 3 ? 'border-orange-400 bg-orange-50 text-orange-600' : 'border-primary bg-blue-50 text-primary') : 'border-border bg-white text-slate-500'}`}>{PRIORITY[p]}</button>
            ))}
          </div>
        </div>
        <button className={`${button} w-full`} disabled={busy}><Plus size={17} />{busy ? 'Đang tạo…' : 'Tạo và chọn người thực hiện'}</button>
      </form>
    </>
  );
}
