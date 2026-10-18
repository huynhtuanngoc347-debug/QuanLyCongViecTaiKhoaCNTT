import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, FileUp, Info, ShieldCheck, Upload, X } from 'lucide-react';
import type { AssignmentDto, TaskDetailDto } from '@khoa/shared';
import { send, upload } from '../api';
import { useSession } from '../session';
import { FieldError, LoadError, PageHeader, StateView, button, field, useAfterChange, useTaskDetail, useUi } from '../ui';
import { kb, relative } from '../format';

/** Lấy chi tiết + phân công của chính người dùng; trả về màn hình lỗi nếu không có quyền thao tác. */
function useMine(): { d?: TaskDetailDto; a?: AssignmentDto; view?: React.ReactNode } {
  const id = Number(useParams().id);
  const q = useTaskDetail(id);
  const { session } = useSession();
  if (!q.data) return { view: q.error ? <><PageHeader title="Công việc" back="/tasks" /><LoadError error={q.error} /></> : <StateView kind="loading" /> };
  const d = q.data;
  const a = d.assignments.find((x) => x.id === d.summary.myAssignmentId) ?? d.assignments.find((x) => x.personId === session?.user.id && x.status < 5);
  if (!a) return { view: <><PageHeader title="Không thực hiện được" back /><StateView kind="error" text="Bạn không được giao việc này nên không cập nhật được." /></> };
  return { d, a };
}

function TaskHead({ d }: { d: TaskDetailDto }) {
  return (
    <div className="mb-6 rounded-2xl border border-border bg-white p-4">
      <p className="mb-2 text-[11px] text-primary">{d.summary.categoryName || d.summary.unitName}</p>
      <h2 className="text-[15px] font-bold leading-6">{d.summary.title}</h2>
    </div>
  );
}

export function UpdatePage() {
  const { d, a, view } = useMine();
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useUi();
  const after = useAfterChange();
  const navigate = useNavigate();
  if (view || !d || !a) return <>{view}</>;
  if (!a.actions.canUpdateProgress) return <><PageHeader title="Cập nhật tiến độ" back /><StateView kind="error" title="Chưa cập nhật được" text="Việc đang chờ tiếp nhận, chờ duyệt hoặc đã đóng." /></>;
  const v = value ?? Math.round(a.progress);
  const last = a.progressHistory[0];
  return (
    <>
      <PageHeader title="Cập nhật tiến độ" back />
      <TaskHead d={d} />
      <div className="mb-8 rounded-[24px] bg-[#edf2ff] p-6 text-center">
        <p className="text-[13px] font-semibold text-slate-500">Bạn đã hoàn thành bao nhiêu?</p>
        <p className="my-6 text-[64px] font-extrabold leading-none text-primary">{v}<span className="text-2xl">%</span></p>
        <input type="range" aria-label="Tiến độ công việc" min="0" max="100" step="5" value={v} onChange={(e) => setValue(Number(e.target.value))} className="h-11 w-full accent-blue-600" />
        <div className="flex justify-between text-[11px] text-slate-400"><span>Chưa bắt đầu</span><span>Hoàn thành</span></div>
        {last ? <p className="mt-3 text-[11px] text-slate-500">Lần trước: {Math.round(last.percent)}% · {relative(last.at)}</p> : null}
      </div>
      <div className="mb-7 flex gap-2">
        {[0, 25, 50, 75, 100].map((n) => (
          <button key={n} onClick={() => setValue(n)} className={`min-h-11 flex-1 rounded-xl border text-[13px] font-bold transition ${v === n ? 'border-primary bg-blue-50 text-primary' : 'border-border bg-white text-slate-500'}`}>{n}%</button>
        ))}
      </div>
      <label className="text-xs font-bold">Đã làm được gì *
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} className={`${field} mt-3 resize-none`} placeholder="Ví dụ: xong chương 1–4, đang soạn phần đánh giá..." />
        <FieldError text={errors?.note ?? errors?.percent} />
      </label>
      <div className="my-6 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-[12px] leading-5 text-emerald-700">
        <ShieldCheck size={18} className="shrink-0" />{a.assigner.name} sẽ thấy cập nhật này. Báo 100% chưa phải là nộp kết quả.
      </div>
      <button className={`${button} w-full`} disabled={busy} onClick={async () => {
        if (!note.trim()) { setErrors({ note: 'Ghi lại đã làm được gì trong lần cập nhật này.' }); return; }
        setBusy(true);
        try {
          const r = await send('POST', `/api/phan-cong/${a.id}/tien-do`, { percent: v, note: note.trim() });
          if (r.errors) { setErrors(r.errors); return; }
          after(d.summary.id); notify(`Đã cập nhật tiến độ ${v}%.`); navigate(`/tasks/${d.summary.id}`, { replace: true });
        } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
      }}><Check size={18} />{busy ? 'Đang lưu…' : 'Lưu cập nhật'}</button>
    </>
  );
}

export function SubmitPage() {
  const { d, a, view } = useMine();
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useUi();
  const after = useAfterChange();
  const navigate = useNavigate();
  if (view || !d || !a) return <>{view}</>;
  if (!a.actions.canSubmit) return <><PageHeader title="Nộp kết quả" back /><StateView kind="error" title="Chưa nộp được" text="Kết quả trước đang chờ duyệt, hoặc việc chưa được tiếp nhận." /></>;
  const needFix = a.results[0]?.status === 2 ? a.results[0].review?.comment : null;
  return (
    <>
      <PageHeader title="Nộp kết quả" back subtitle={`Lần nộp ${a.results.length + 1}. Sau khi nộp, việc chuyển sang “Chờ duyệt”.`} />
      <TaskHead d={d} />
      {needFix ? <div className="mb-5 rounded-xl border border-[#f2e5d4] bg-[#fff8ed] p-4 text-[13px] leading-6 text-[#8a704d]"><b>Yêu cầu bổ sung:</b> {needFix}</div> : null}
      {d.criteria ? <div className="mb-5 flex gap-2 rounded-xl bg-blue-50 p-4 text-[13px] leading-6 text-blue-800"><Info size={18} className="mt-0.5 shrink-0" /><span><b>Tiêu chí hoàn thành:</b> {d.criteria}</span></div> : null}
      <div className="space-y-5">
        <label className="block text-xs font-bold">Mô tả kết quả *
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} maxLength={8000} className={`${field} mt-2.5 resize-none`} placeholder="Đã hoàn thành những gì, kết quả nằm ở đâu..." />
          <FieldError text={errors?.content} />
        </label>
        <div>
          <span className="text-xs font-bold">Tệp đính kèm</span>
          <label className="mt-2.5 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-white p-4 text-center text-[13px] text-slate-500 active:bg-blue-50">
            <FileUp size={24} className="text-primary" />
            Chạm để chọn tệp<span className="text-[11px] text-slate-400">Tối đa 10 tệp, mỗi tệp 20 MB</span>
            <input type="file" multiple className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.zip,.rar,.7z" onChange={(e) => setFiles([...files, ...(e.target.files ?? [])].slice(0, 10))} />
          </label>
          {files.map((f, i) => (
            <div key={i} className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-white p-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{f.name}</span><span className={`text-[11px] ${f.size > 20 * 1048576 ? 'text-red-500' : 'text-slate-400'}`}>{kb(f.size)}{f.size > 20 * 1048576 ? ' · quá 20 MB' : ''}</span></span>
              <button aria-label={`Bỏ ${f.name}`} className="flex size-9 items-center justify-center text-slate-400" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={16} /></button>
            </div>
          ))}
          <FieldError text={errors?.files} />
        </div>
        <label className="block text-xs font-bold">Liên kết (không bắt buộc)
          <input value={link} onChange={(e) => setLink(e.target.value)} type="url" inputMode="url" placeholder="https://drive.google.com/..." className={`${field} mt-2.5`} />
          <FieldError text={errors?.link} />
        </label>
        <button className={`${button} w-full`} disabled={busy} onClick={async () => {
          const errs: Record<string, string> = {};
          if (!content.trim()) errs.content = 'Mô tả kết quả đã làm được.';
          const big = files.find((f) => f.size > 20 * 1048576); if (big) errs.files = `Tệp “${big.name}” lớn hơn 20 MB.`;
          if (link.trim() && !/^https?:\/\//i.test(link.trim())) errs.link = 'Liên kết phải bắt đầu bằng http:// hoặc https://.';
          if (Object.keys(errs).length) { setErrors(errs); return; }
          const fd = new FormData(); fd.append('content', content.trim()); fd.append('link', link.trim());
          files.forEach((f) => fd.append('files', f, f.name));
          setBusy(true);
          try {
            const r = await upload(`/api/phan-cong/${a.id}/ket-qua`, fd);
            if (r.errors) { setErrors(r.errors); return; }
            after(d.summary.id); notify('Đã nộp kết quả. Người giao sẽ nhận thông báo để duyệt.'); navigate(`/tasks/${d.summary.id}`, { replace: true });
          } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
        }}><Upload size={18} />{busy ? 'Đang nộp…' : 'Nộp kết quả'}</button>
      </div>
    </>
  );
}
