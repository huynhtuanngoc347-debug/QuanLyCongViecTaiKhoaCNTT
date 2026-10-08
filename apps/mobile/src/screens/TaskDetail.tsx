import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarDays, Check, ClipboardCheck, Download, FileText, Flag, MoreHorizontal, Paperclip, Send, Settings2, Upload, UserRound, X } from 'lucide-react';
import type { AssignmentDto, CommentDto, FileDto, ResultDto, TaskDetailDto } from '@khoa/shared';
import { api, get, send, upload } from '../api';
import { useSession } from '../session';
import { Avatar, Badge, FieldError, PageHeader, PRIORITY, Progress, SectionTitle, Sheet, StateView, button, buttonGhost, field, statusOf, useAfterChange, useTaskDetail, useUi } from '../ui';
import { friendly, fullDate, kb, relative, remaining } from '../format';

const A_STATUS: Record<number, string> = { 0: 'Chờ tiếp nhận', 1: 'Đã tiếp nhận', 2: 'Đang làm', 3: 'Chờ duyệt', 4: 'Hoàn thành', 5: 'Từ chối', 6: 'Đã hủy' };
const A_BADGE: Record<number, string> = { 0: 'Chờ làm', 1: 'Đang làm', 2: 'Đang làm', 3: 'Chờ duyệt', 4: 'Hoàn thành', 5: 'Đã hủy', 6: 'Đã hủy' };
const RESULT: Record<number, [string, string]> = { 0: ['Chờ duyệt', 'bg-violet-50 text-violet-600'], 1: ['Đạt', 'bg-emerald-50 text-emerald-700'], 2: ['Cần bổ sung', 'bg-amber-50 text-amber-700'], 3: ['Không đạt', 'bg-red-50 text-red-600'] };
const VIEWABLE = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'txt'];

function Files({ files }: { files: FileDto[] }) {
  return (
    <div className="space-y-2">
      {files.map((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        return (
          <a key={f.id} href={VIEWABLE.includes(ext) ? `/api/tep/${f.id}?xem=1` : `/api/tep/${f.id}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-border bg-white p-3 text-left active:scale-[0.99]">
            <span className="rounded-lg bg-blue-50 p-2 text-primary"><FileText size={21} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{f.name}</span>
              <span className="text-[11px] text-slate-400">{kb(f.size)} · {VIEWABLE.includes(ext) ? 'Chạm để xem' : 'Tải xuống'}</span>
            </span>
            {VIEWABLE.includes(ext) ? <Paperclip size={16} className="text-slate-400" /> : <Download size={16} className="text-slate-400" />}
          </a>
        );
      })}
    </div>
  );
}

function ResultBlock({ r }: { r: ResultDto }) {
  const [label, cls] = RESULT[r.status] ?? RESULT[0];
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-slate-500">Lần nộp {r.attempt} · {relative(r.submittedAt)}</span>
        <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${cls}`}>{label}</span>
      </div>
      <p className="mb-3 whitespace-pre-wrap text-[13px] leading-6 text-slate-600">{r.content}</p>
      {r.files.length ? <Files files={r.files} /> : null}
      {r.review ? (
        <div className="mt-3 rounded-xl bg-[#eef1fa] p-3 text-[12.5px] leading-5">
          <b>{r.review.reviewer.name}</b> <span className="text-slate-500">· {relative(r.review.at)}</span>
          {r.review.comment ? <p className="mt-1 text-slate-600">{r.review.comment}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------- Bảng trượt: đánh giá, gia hạn, xin từ chối, lý do ----------------
type SheetState =
  | { kind: 'evaluate'; a: AssignmentDto; r: ResultDto }
  | { kind: 'extension'; a: AssignmentDto }
  | { kind: 'decline'; a: AssignmentDto }
  | { kind: 'reason'; a: AssignmentDto; action: 'tu-choi' | 'xin-tu-choi' };

function ChoiceRow({ items, value, onChange }: { items: [string, string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(([v, l, tone]) => (
        <button type="button" key={v} onClick={() => onChange(v)}
          className={`min-h-12 rounded-xl border px-2 text-[13px] font-bold transition ${value === v ? tone : 'border-border bg-white text-slate-500'}`}>{l}</button>
      ))}
    </div>
  );
}

function ActionSheet({ s, d, onClose }: { s: SheetState; d: TaskDetailDto; onClose: () => void }) {
  const { notify } = useUi();
  const after = useAfterChange();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [decision, setDecision] = useState(s.kind === 'evaluate' ? '1' : 'approve');
  const ext = s.kind === 'extension' ? s.a.extensions.find((x) => x.status === 0) : undefined;
  const dec = s.kind === 'decline' ? s.a.declines.find((x) => x.status === 0) : undefined;
  const [due, setDue] = useState(ext ? ext.proposedDue.slice(0, 10) : '');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get('text') || '').trim();
    let path = '', body: Record<string, unknown> = {}, done = '';
    if (s.kind === 'evaluate') {
      if (decision !== '1' && !text) { setErrors({ comment: 'Nhập nhận xét để người thực hiện biết cần sửa gì.' }); return; }
      path = `/api/ket-qua/${s.r.id}/danh-gia`; body = { decision: Number(decision), comment: text };
      done = ({ 1: 'Đã duyệt: Đạt.', 2: 'Đã yêu cầu bổ sung.', 3: 'Đã đánh giá: Không đạt.' } as Record<string, string>)[decision];
    } else if (s.kind === 'extension' && ext) {
      if (decision !== 'approve' && !text) { setErrors({ comment: decision === 'reject' ? 'Nhập lý do từ chối.' : 'Nhập nhận xét khi duyệt hạn khác.' }); return; }
      path = `/api/gia-han/${ext.id}/duyet`; body = { decision, approvedDue: decision === 'approve-other' ? due : null, comment: text };
      done = decision === 'reject' ? 'Đã từ chối yêu cầu gia hạn.' : 'Đã duyệt gia hạn.';
    } else if (s.kind === 'decline' && dec) {
      if (decision === 'reject' && !text) { setErrors({ comment: 'Nhập lý do không đồng ý.' }); return; }
      path = `/api/xin-tu-choi/${dec.id}/duyet`; body = { decision, comment: text };
      done = decision === 'approve' ? 'Đã đồng ý cho thôi nhận việc.' : 'Đã không đồng ý. Người nhận tiếp tục thực hiện.';
    } else if (s.kind === 'reason') {
      if (!text) { setErrors({ reason: 'Nhập lý do.' }); return; }
      path = `/api/phan-cong/${s.a.id}/${s.action}`; body = { reason: text };
      done = s.action === 'tu-choi' ? 'Đã từ chối nhận việc.' : 'Đã gửi yêu cầu xin từ chối. Người giao sẽ xem xét.';
    }
    setBusy(true);
    try {
      const r = await send('POST', path, body);
      if (r.errors) { setErrors(r.errors); return; }
      after(d.summary.id); notify(done); onClose();
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  }

  const title = s.kind === 'evaluate' ? 'Đánh giá kết quả' : s.kind === 'extension' ? 'Duyệt gia hạn' : s.kind === 'decline' ? 'Duyệt xin từ chối' : s.action === 'tu-choi' ? 'Từ chối nhận việc' : 'Xin thôi nhận việc';
  return (
    <Sheet title={title} onClose={onClose}>
      <form noValidate onSubmit={submit}>
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-[#eef1fa] p-3">
          <Avatar name={s.a.initials} small />
          <p className="text-[13px]"><b>{s.a.name}</b><span className="text-slate-500"> · {d.summary.title}</span></p>
        </div>
        {s.kind === 'evaluate' ? (
          <>
            <ResultBlock r={s.r} />
            {d.criteria ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-[12.5px] leading-5 text-blue-800"><b>Tiêu chí:</b> {d.criteria}</p> : null}
            <h3 className="mb-3 mt-5 text-sm font-bold">Kết luận</h3>
            <ChoiceRow value={decision} onChange={setDecision} items={[['1', 'Đạt', 'border-emerald-500 bg-emerald-50 text-emerald-700'], ['2', 'Cần bổ sung', 'border-amber-500 bg-amber-50 text-amber-700'], ['3', 'Không đạt', 'border-red-500 bg-red-50 text-red-600']]} />
          </>
        ) : s.kind === 'extension' && ext ? (
          <>
            <p className="mb-4 text-[13px] leading-6 text-slate-600">Đề nghị dời hạn từ <b>{fullDate(ext.oldDue)}</b> sang <b>{fullDate(ext.proposedDue)}</b>.<br />Lý do: {ext.reason}</p>
            <ChoiceRow value={decision} onChange={setDecision} items={[['approve', 'Đồng ý', 'border-primary bg-blue-50 text-primary'], ['approve-other', 'Hạn khác', 'border-primary bg-blue-50 text-primary'], ['reject', 'Từ chối', 'border-red-500 bg-red-50 text-red-600']]} />
            {decision === 'approve-other' ? <label className="mb-4 block text-xs font-bold">Hạn mới<input type="date" value={due} min={ext.oldDue.slice(0, 10)} onChange={(e) => setDue(e.target.value)} className={`${field} mt-2`} /><FieldError text={errors?.approvedDue} /></label> : null}
          </>
        ) : s.kind === 'decline' && dec ? (
          <>
            <p className="mb-4 text-[13px] leading-6 text-slate-600">Lý do xin thôi: {dec.reason}</p>
            <ChoiceRow value={decision} onChange={setDecision} items={[['approve', 'Đồng ý cho thôi', 'border-primary bg-blue-50 text-primary'], ['reject', 'Không đồng ý', 'border-red-500 bg-red-50 text-red-600']]} />
          </>
        ) : (
          <p className="mb-4 text-[13px] leading-6 text-slate-500">{s.kind === 'reason' && s.action === 'tu-choi' ? 'Người giao sẽ nhận được lý do và có thể giao cho người khác.' : 'Bạn đã tiếp nhận việc nên cần người giao đồng ý. Trong lúc chờ, bạn vẫn là người thực hiện.'}</p>
        )}
        <label className="block text-xs font-bold">
          {s.kind === 'reason' ? 'Lý do *' : 'Nhận xét'}
          <textarea name="text" rows={3} maxLength={1000} className={`${field} mt-2 resize-none`} placeholder={s.kind === 'reason' ? 'Ví dụ: trùng lịch giảng dạy tuần này…' : 'Không bắt buộc khi đồng ý / Đạt'} />
          <FieldError text={errors?.comment ?? errors?.reason} />
        </label>
        <button className={`${button} mt-5 w-full`} disabled={busy}>{busy ? 'Đang gửi…' : 'Xác nhận'}</button>
      </form>
    </Sheet>
  );
}

// ---------------- Thảo luận ----------------
function Discussion({ d }: { d: TaskDetailDto }) {
  const id = d.summary.id;
  const { notify } = useUi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['comments', id], queryFn: () => get<CommentDto[]>(`/api/cong-viec/${id}/binh-luan`), staleTime: 10_000 });
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<CommentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const roots = (q.data ?? []).filter((c) => !c.parentId);
  const replies = (pid: number) => (q.data ?? []).filter((c) => c.parentId === pid);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !files.length) return;
    const root = replyTo ? (replyTo.parentId ?? replyTo.id) : null;
    setBusy(true);
    try {
      let r;
      if (files.length) {
        const fd = new FormData(); fd.append('content', text.trim());
        if (replyTo) { fd.append('parentId', String(root)); fd.append('replyToId', String(replyTo.author.id)); }
        files.forEach((f) => fd.append('files', f));
        r = await upload(`/api/cong-viec/${id}/binh-luan`, fd);
      } else r = await send('POST', `/api/cong-viec/${id}/binh-luan`, { content: text.trim(), parentId: root, replyToId: replyTo?.author.id ?? null });
      if (r.errors) { notify(Object.values(r.errors)[0], true); return; }
      setText(''); setFiles([]); setReplyTo(null);
      void qc.invalidateQueries({ queryKey: ['comments', id] });
      notify(replyTo ? `Đã trả lời ${replyTo.author.name}.` : 'Đã gửi bình luận.');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  }
  const Item = ({ c, nested }: { c: CommentDto; nested?: boolean }) => (
    <div className={`mb-4 flex gap-3 ${nested ? 'ml-10' : ''}`}>
      <Avatar small name={c.author.initials} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px]"><strong>{c.author.name}</strong> <span className="text-slate-400">· {relative(c.createdAt)}</span></p>
        {c.content ? <p className="mt-1.5 whitespace-pre-wrap rounded-xl rounded-tl-none bg-white p-3 text-[13px] leading-5 text-slate-600">{c.content}</p> : null}
        {c.files.length ? <div className="mt-2"><Files files={c.files} /></div> : null}
        {d.permissions.canComment ? <button className="mt-1 min-h-9 text-[12px] font-semibold text-primary" onClick={() => setReplyTo(c)}>Trả lời</button> : null}
      </div>
    </div>
  );
  return (
    <>
      <SectionTitle>Thảo luận <span className="ml-2 text-xs font-medium text-slate-400">{q.data?.length ?? ''}</span></SectionTitle>
      {!q.data ? <p className="mb-4 text-[13px] text-slate-400">Đang tải bình luận…</p>
        : roots.length ? roots.map((c) => <div key={c.id}><Item c={c} />{replies(c.id).map((r) => <Item key={r.id} c={r} nested />)}</div>)
          : <p className="mb-4 text-[13px] text-slate-400">Chưa có trao đổi nào.</p>}
      {d.permissions.canComment ? (
        <form className="mb-6" onSubmit={submit}>
          {replyTo ? (
            <div className="mb-2 flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2 text-[12px] text-primary">
              <span>Đang trả lời <b>{replyTo.author.name}</b></span>
              <button type="button" aria-label="Bỏ trả lời" className="flex size-8 items-center justify-center" onClick={() => setReplyTo(null)}><X size={15} /></button>
            </div>
          ) : null}
          {files.length ? <p className="mb-2 text-[12px] text-slate-500">{files.length} tệp: {files.map((f) => f.name).join(', ')}</p> : null}
          <div className="flex gap-2">
            <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-white text-slate-500" aria-label="Đính kèm tệp">
              <Paperclip size={18} /><input type="file" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 10))} />
            </label>
            <input className={field} placeholder="Viết bình luận..." value={text} onChange={(e) => setText(e.target.value)} aria-label="Bình luận" />
            <button className="flex w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white active:scale-95" aria-label="Gửi bình luận" disabled={busy}><Send size={18} /></button>
          </div>
        </form>
      ) : null}
    </>
  );
}

// ---------------- Màn hình chi tiết ----------------
export function TaskDetail() {
  const id = Number(useParams().id);
  const q = useTaskDetail(id);
  const { session } = useSession();
  const { notify } = useUi();
  const after = useAfterChange();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data) return q.error ? <><PageHeader title="Chi tiết công việc" back="/tasks" /><StateView kind="error" text={(q.error as Error).message} /></> : <StateView kind="loading" />;
  const d = q.data, t = d.summary;
  const mine = d.assignments.find((a) => a.id === t.myAssignmentId) ?? d.assignments.find((a) => a.personId === session?.user.id && a.status < 5);
  const progress = mine ? mine.progress : t.progress;
  const due = mine?.due ?? t.due;
  const r = [1, 2, 5].includes(t.status) ? remaining(due) : null;
  const pendingEval = d.assignments.flatMap((a) => (a.actions.canEvaluate && a.results[0]?.status === 0 ? [{ a, r: a.results[0] }] : []));
  const act = async (path: string, done: string) => {
    setBusy(true);
    try { await api('POST', path); after(t.id); notify(done); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };

  // Thanh hành động chính, ưu tiên việc người dùng cần làm ngay.
  let actions: ReactNode = null;
  if (mine?.actions.canAccept) {
    actions = <div className="flex gap-3">{mine.actions.canReject ? <button className={buttonGhost} onClick={() => setSheet({ kind: 'reason', a: mine, action: 'tu-choi' })}>Từ chối</button> : null}<button className={`${button} flex-1`} disabled={busy} onClick={() => void act(`/api/phan-cong/${mine.id}/tiep-nhan`, 'Đã tiếp nhận việc.')}><Check size={18} />Tiếp nhận việc</button></div>;
  } else if (mine && (mine.actions.canSubmit || mine.actions.canUpdateProgress)) {
    actions = (
      <div className="flex gap-3">
        {mine.actions.canUpdateProgress ? <Link to={`/tasks/${t.id}/update`} className={mine.actions.canSubmit ? buttonGhost : `${button} flex-1`}><Settings2 size={17} />{mine.actions.canSubmit ? 'Tiến độ' : 'Cập nhật tiến độ'}</Link> : null}
        {mine.actions.canSubmit ? <Link to={`/tasks/${t.id}/submit`} className={`${button} flex-1`}><Upload size={17} />Nộp kết quả</Link> : null}
      </div>
    );
  } else if (pendingEval.length) {
    actions = <button className={`${button} w-full`} onClick={() => setSheet({ kind: 'evaluate', ...pendingEval[0] })}><ClipboardCheck size={18} />Đánh giá kết quả{pendingEval.length > 1 ? ` (${pendingEval.length})` : ''}</button>;
  }

  return (
    <>
      <PageHeader title="Chi tiết công việc" back action={<button aria-label="Tùy chọn công việc" onClick={() => setMenu(!menu)} className="flex size-11 items-center justify-center"><MoreHorizontal size={23} /></button>} />
      {menu ? (
        <div className="mb-4 animate-enter rounded-xl border border-border bg-white p-2">
          <button className="min-h-11 w-full rounded-lg text-sm text-primary active:bg-blue-50" onClick={() => { void navigator.clipboard?.writeText(window.location.href); notify('Đã sao chép liên kết công việc'); setMenu(false); }}>Sao chép liên kết</button>
          {mine?.actions.canRequestDecline ? <button className="min-h-11 w-full rounded-lg text-sm text-red-500 active:bg-red-50" onClick={() => { setMenu(false); setSheet({ kind: 'reason', a: mine, action: 'xin-tu-choi' }); }}>Xin thôi nhận việc</button> : null}
          <a className="flex min-h-11 w-full items-center justify-center rounded-lg text-sm text-slate-500" href={`/#/cong-viec/chi-tiet?id=${t.id}`}>Mở trên bản máy tính</a>
        </div>
      ) : null}

      <span className="text-[12px] font-semibold text-primary">{t.categoryName || 'Chưa phân loại'} · {t.unitName}</span>
      <h2 className="mb-5 mt-2 text-[24px] font-extrabold leading-[1.35]">{t.title}</h2>
      <div className="mb-5 flex flex-wrap gap-2">
        <Badge status={statusOf(t)} />
        <span className={`flex items-center gap-1 rounded-md px-2 text-[11px] font-semibold ${t.priority >= 3 ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-500'}`}><Flag size={11} />Ưu tiên {PRIORITY[t.priority].toLowerCase()}</span>
        {mine ? <span className="flex items-center gap-1 rounded-md bg-blue-50 px-2 text-[11px] font-semibold text-primary"><UserRound size={11} />{mine.role === 1 ? 'Bạn chủ trì' : mine.role === 2 ? 'Bạn phối hợp' : 'Việc của bạn'}</span> : null}
      </div>

      <div className="mb-7 rounded-2xl border border-border bg-white p-4">
        <div className="mb-3 flex items-center justify-between text-[13px]">
          <span className="font-semibold">{mine ? 'Tiến độ của bạn' : 'Tiến độ chung'}</span>
          <strong className="text-primary">{Math.round(progress)}%</strong>
        </div>
        <Progress value={progress} tone={r?.late ? 'red' : undefined} />
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[13px] text-slate-500">
          <CalendarDays size={15} /><span>Hạn hoàn thành</span>
          <strong className={`ml-auto text-[12px] ${r?.late ? 'text-red-500' : 'text-slate-700'}`}>{friendly(due)}{r?.text ? ` · ${r.text}` : ''}</strong>
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[13px] text-slate-500">
          <UserRound size={15} /><span>Người giao</span><strong className="ml-auto text-[12px] text-slate-700">{mine?.assigner.name ?? t.creatorName}</strong>
        </div>
      </div>

      {d.description ? <><SectionTitle>Mô tả công việc</SectionTitle><p className="mb-7 whitespace-pre-wrap text-[13px] leading-6 text-slate-500">{d.description}</p></> : null}
      {d.criteria ? <><SectionTitle>Tiêu chí hoàn thành</SectionTitle><p className="mb-7 rounded-2xl bg-blue-50 p-4 text-[13px] leading-6 text-blue-800">{d.criteria}</p></> : null}
      {d.files.length ? <><SectionTitle>Tài liệu đính kèm</SectionTitle><div className="mb-7"><Files files={d.files} /></div></> : null}

      {mine?.results.length ? (
        <>
          <SectionTitle>Kết quả của bạn</SectionTitle>
          <div className="mb-7 space-y-3">{mine.results.slice(0, 2).map((x) => <ResultBlock key={x.id} r={x} />)}</div>
        </>
      ) : null}

      <SectionTitle>Phân công <span className="ml-2 text-xs font-medium text-slate-400">{d.assignments.filter((a) => a.status < 5).length} người / đơn vị</span></SectionTitle>
      <div className="mb-7 space-y-2">
        {d.assignments.length ? d.assignments.map((a) => {
          const ar = [0, 1, 2].includes(a.status) ? remaining(a.due) : null;
          const ext = a.actions.canDecideExtension && a.extensions.some((x) => x.status === 0);
          const dec = a.actions.canDecideDecline && a.declines.some((x) => x.status === 0);
          const ev = a.actions.canEvaluate && a.results[0]?.status === 0;
          return (
            <div key={a.id} className={`rounded-2xl p-4 ${a.id === mine?.id ? 'border border-blue-100 bg-[#edf2ff]' : 'bg-[#eef1fa]'}`}>
              <div className="flex items-center gap-3">
                <Avatar name={a.initials} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">{a.name}{a.id === mine?.id ? ' (bạn)' : ''}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">{a.role === 1 ? 'Chủ trì' : a.role === 2 ? 'Phối hợp' : a.kind === 'unit' ? 'Đơn vị' : 'Cá nhân'} · {A_STATUS[a.status]}{ar?.late ? ` · ${ar.text}` : ''}</p>
                </div>
                <Badge status={A_BADGE[a.status]} />
              </div>
              <div className="mt-3 flex items-center gap-3"><div className="flex-1"><Progress value={a.progress} tone={a.overdue ? 'red' : undefined} /></div><span className="text-[11px] font-bold text-slate-500">{Math.round(a.progress)}%</span></div>
              {ev || ext || dec || a.actions.canRemind ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {ev ? <button className="min-h-10 rounded-xl bg-primary px-3 text-[12px] font-bold text-white" onClick={() => setSheet({ kind: 'evaluate', a, r: a.results[0] })}>Đánh giá kết quả</button> : null}
                  {ext ? <button className="min-h-10 rounded-xl bg-white px-3 text-[12px] font-bold text-primary" onClick={() => setSheet({ kind: 'extension', a })}>Duyệt gia hạn</button> : null}
                  {dec ? <button className="min-h-10 rounded-xl bg-white px-3 text-[12px] font-bold text-red-500" onClick={() => setSheet({ kind: 'decline', a })}>Duyệt xin thôi</button> : null}
                  {a.actions.canRemind ? <button className="flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-[12px] font-bold text-slate-600" disabled={busy} onClick={() => void act(`/api/phan-cong/${a.id}/nhac`, `Đã nhắc ${a.name}.`)}><BellRing size={14} />Nhắc việc</button> : null}
                </div>
              ) : null}
            </div>
          );
        }) : <p className="text-[13px] text-slate-400">Chưa giao cho ai. Giao việc trên bản máy tính.</p>}
      </div>

      <Discussion d={d} />

      {actions ? <div className="sticky bottom-24 z-10 -mx-2 rounded-2xl bg-background/95 px-2 pb-1 pt-2 backdrop-blur">{actions}</div> : null}
      {sheet ? <ActionSheet s={sheet} d={d} onClose={() => setSheet(null)} /> : null}
      {t.status === 6 ? <p className="mt-4 text-center text-[12px] text-slate-400">Công việc đã hủy. <button className="text-primary" onClick={() => navigate('/tasks')}>Về danh sách</button></p> : null}
    </>
  );
}
