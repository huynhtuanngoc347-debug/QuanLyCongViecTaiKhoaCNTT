import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssignOptionsDto, AssignmentDto, TaskDetailDto } from '@khoa/shared';
import { api, get, send, upload } from '../api/client';
import { Avatar, ErrorSummary, Field, Input, Loading, Modal, PRIORITY, Seg, Select, Textarea, useUi } from '../ui/ui';
import { DAY, addDaysIso, fmtDay, fmtShort, isoDay, normalize, pct, relative, toDate, todayIso } from '../format';
import { useAfterChange } from './queries';
import { FileList } from './TaskDetail';

export type DialogKind = 'assign' | 'delegate' | 'progress' | 'submit' | 'evaluate' | 'extension' | 'decide' | 'reject' | 'decline-request' | 'decline-decide' | 'cancel-assignment' | 'status';
export interface DialogRequest { kind: DialogKind; taskId: number; assignmentId?: number; resultId?: number; extensionId?: number; declineId?: number; status?: string; progress?: number; title?: string; }

interface TaskActions {
  open: (req: DialogRequest) => void;
  accept: (taskId: number, assignmentId: number) => Promise<void>;
  remind: (assignmentId: number) => Promise<void>;
  changeStatus: (taskId: number, action: string) => Promise<void>;
}
const Ctx = createContext<TaskActions | null>(null);
export const useTaskActions = (): TaskActions => {
  const v = useContext(Ctx);
  if (!v) throw new Error('TaskActionsProvider missing');
  return v;
};

const STATUS_DONE: Record<string, string> = { publish: 'Đã tạo chính thức công việc.', pause: 'Đã tạm dừng công việc.', resume: 'Đã tiếp tục công việc.', cancel: 'Đã hủy công việc.', complete: 'Đã đóng công việc: Hoàn thành.' };

/** Nơi hiển thị mọi hộp thoại thao tác công việc (dùng chung cho danh sách, chi tiết, trang cá nhân). */
export function TaskActionsProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [detail, setDetail] = useState<TaskDetailDto | null>(null);
  const qc = useQueryClient();
  const { toast, ask } = useUi();
  const afterChange = useAfterChange();

  const loadDetail = (taskId: number) => qc.fetchQuery({ queryKey: ['detail', taskId], queryFn: () => get<TaskDetailDto>(`/api/cong-viec/${taskId}`), staleTime: 5_000 });
  const close = () => { setReq(null); setDetail(null); };
  const done = (text: string, taskId: number) => { close(); afterChange(taskId); toast(text); };

  const actions: TaskActions = {
    open: (r) => {
      setDetail(null);
      setReq(r);
      loadDetail(r.taskId).then(setDetail).catch((e) => { toast((e as Error).message, true); setReq(null); });
    },
    accept: async (taskId, assignmentId) => {
      try { await api('POST', `/api/phan-cong/${assignmentId}/tiep-nhan`); afterChange(taskId); toast('Đã tiếp nhận việc.'); } catch (e) { toast((e as Error).message, true); }
    },
    remind: async (assignmentId) => {
      try { await api('POST', `/api/phan-cong/${assignmentId}/nhac`); toast('Đã gửi nhắc việc.'); } catch (e) { toast((e as Error).message, true); }
    },
    changeStatus: async (taskId, action) => {
      if (action === 'cancel' || action === 'pause') { actions.open({ kind: 'status', taskId, status: action }); return; }
      const msg: Record<string, [string, string, string]> = {
        publish: ['Tạo chính thức?', 'Công việc chuyển sang “Chưa bắt đầu” và bạn có thể giao việc.', 'Tạo chính thức'],
        resume: ['Tiếp tục công việc?', 'Người nhận sẽ được thông báo và tiếp tục cập nhật tiến độ.', 'Tiếp tục'],
        complete: ['Đóng công việc là Hoàn thành?', 'Mọi phân công đã được duyệt Đạt. Sau khi đóng, công việc không sửa được nữa.', 'Đóng: Hoàn thành'],
      };
      const [title, message, yes] = msg[action];
      if (!(await ask(message, title, yes))) return;
      try {
        const r = await send('POST', `/api/cong-viec/${taskId}/trang-thai`, { action, note: '' });
        if (r.errors) { toast(Object.values(r.errors)[0], true); return; }
        afterChange(taskId); toast(STATUS_DONE[action]);
      } catch (e) { toast((e as Error).message, true); }
    },
  };

  let dialog: ReactNode = null;
  if (req) {
    const a = detail?.assignments.find((x) => x.id === req.assignmentId);
    if (!detail) dialog = <Modal title="Đang tải…" onClose={close}><Loading /></Modal>;
    else {
      switch (req.kind) {
        case 'assign': dialog = <AssignDialog d={detail} onClose={close} onDone={done} />; break;
        case 'delegate': dialog = a ? <DelegateDialog d={detail} a={a} onClose={close} onDone={done} onReject={() => setReq({ ...req, kind: 'reject' })} /> : null; break;
        case 'progress': dialog = a ? <ProgressDialog d={detail} a={a} onClose={close} onDone={done} /> : null; break;
        case 'submit': dialog = a ? <SubmitDialog d={detail} a={a} onClose={close} onDone={done} /> : null; break;
        case 'evaluate': dialog = a ? <EvaluateDialog a={a} resultId={req.resultId} onClose={close} onDone={(t) => done(t, detail.summary.id)} /> : null; break;
        case 'extension': dialog = a ? <ExtensionDialog d={detail} a={a} onClose={close} onDone={done} /> : null; break;
        case 'decide': dialog = a ? <DecideDialog d={detail} a={a} extensionId={req.extensionId} onClose={close} onDone={done} /> : null; break;
        case 'decline-decide': dialog = a ? <DeclineDecideDialog d={detail} a={a} declineId={req.declineId} onClose={close} onDone={done} /> : null; break;
        case 'reject': case 'decline-request': case 'cancel-assignment': case 'status': dialog = <ReasonDialog req={req} d={detail} a={a} onClose={close} onDone={done} />; break;
      }
    }
  }
  return <Ctx.Provider value={actions}>{children}{dialog}</Ctx.Provider>;
}

type DoneFn = (text: string, taskId: number) => void;
const Actions = ({ onClose, yes, danger = false, busy = false, cancel = 'Hủy' }: { onClose: () => void; yes: string; danger?: boolean; busy?: boolean; cancel?: string }) => (
  <div className="actions form-actions">
    <button type="button" className="button secondary" onClick={onClose}>{cancel}</button>
    <button className={`button ${danger ? 'danger' : ''}`} type="submit" disabled={busy}>{yes}</button>
  </div>
);

function useSubmitter() {
  const { toast } = useUi();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<Record<string, string> | void>) => {
    setBusy(true);
    try {
      const errs = await fn();
      if (errs) setErrors(errs);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  return { errors, setErrors, busy, run };
}

// ---------------- Giao việc ----------------
function AssignDialog({ d, onClose, onDone }: { d: TaskDetailDto; onClose: () => void; onDone: DoneFn }) {
  const [opts, setOpts] = useState<AssignOptionsDto | null>(null);
  const [kind, setKind] = useState('person');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { errors, setErrors, busy, run } = useSubmitter();
  const { toast } = useUi();
  const t = d.summary, due = isoDay(t.due);
  useEffect(() => {
    get<AssignOptionsDto>(`/api/cong-viec/lua-chon-giao-viec?taskId=${t.id}`).then(setOpts).catch((e) => { toast((e as Error).message, true); onClose(); });
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!opts) {
    return <Modal title="Giao việc" subtitle={`${t.title} · hạn chung ${fmtDay(t.due)}`} wide onClose={onClose}><Loading title="Đang tải danh sách người nhận…" /></Modal>;
  }
  const q = normalize(query);
  const people = opts.people.filter((p) => !q || normalize(`${p.name} ${p.unitName}`).includes(q));
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    void run(async () => {
      const errs: Record<string, string> = {};
      if (kind === 'person' && !picked.size) errs.personIds = 'Chọn ít nhất một người nhận.';
      if (kind === 'unit' && !v.unitId) errs.unitId = 'Chọn đơn vị nhận việc.';
      if (Object.keys(errs).length) return errs;
      const r = await send<{ created: number }>('POST', `/api/cong-viec/${t.id}/phan-cong`, { kind, personIds: [...picked], unitId: v.unitId ? Number(v.unitId) : null, role: v.role ? Number(v.role) : null, due: v.due || null, note: v.note || '' });
      if (r.errors) return r.errors;
      onDone(kind === 'unit' ? 'Đã giao cho đơn vị. Trưởng đơn vị sẽ tiếp nhận và phân công lại.' : `Đã giao việc cho ${r.value.created} người.`, t.id);
    });
  };
  return (
    <Modal title="Giao việc" subtitle={`${t.title} · hạn chung ${fmtDay(t.due)}`} wide onClose={onClose}>
      <form id="assign-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <Field name="kind" label="Giao cho" help="Cả đơn vị: trưởng đơn vị nhận và tự phân công lại cho thành viên."><Seg name="kind" items={[['person', 'Cá nhân'], ['unit', 'Cả đơn vị']]} value={kind} onChange={setKind} /></Field>
        <div id="assign-person" className="stack-sm" hidden={kind !== 'person'}>
          <Field name="personIds" label="Người nhận *" error={errors?.personIds} help="Số “việc đang mở” giúp tránh giao dồn cho một người.">
            <input id="person-search" type="search" placeholder="Tìm tên hoặc đơn vị…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby="personIds-error personIds-help" />
            <div className="pick-list" id="person-list" role="group" aria-label="Danh sách người nhận">
              {people.length ? people.slice(0, 80).map((p) => (
                <label key={p.id} className="pick-item">
                  <input type="checkbox" name="personIds" value={p.id} checked={picked.has(p.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(p.id); else n.delete(p.id); setPicked(n); setErrors(null); }} />
                  <Avatar initials={p.initials} tone={p.id} />
                  <span><strong>{p.name}</strong><small className="muted">{p.unitName} · <span className={p.openTasks >= 5 ? 'warn-text' : ''}>{p.openTasks} việc đang mở{p.openTasks >= 5 ? ' · nhiều việc' : ''}</span></small></span>
                </label>
              )) : <p className="muted small">Không có người phù hợp.</p>}
            </div>
          </Field>
        </div>
        <div id="assign-unit" hidden={kind !== 'unit'}>
          <Select name="unitId" label="Đơn vị nhận *" options={opts.units.map((u) => [u.id, `${u.name} · ${u.type}`])} placeholder="Chọn đơn vị" defaultValue="" error={errors?.unitId} />
        </div>
        <div className="form-grid two">
          <Field name="role" label="Vai trò"><Seg name="role" items={[['', 'Không ghi'], ['1', 'Chủ trì'], ['2', 'Phối hợp']]} value="" /></Field>
          {due && due < todayIso()
            // Hạn chung đã qua: không có ngày nào vừa ≥ hôm nay vừa ≤ hạn chung, nên khóa ô và hướng dẫn sửa hạn chung.
            ? <Input name="due" label="Hạn riêng" type="date" value={due} disabled help={`Hạn chung ${fmtDay(t.due)} đã qua: người nhận sẽ dùng hạn chung. Muốn đặt hạn mới, bấm “Sửa” công việc để lùi hạn chung trước.`} error={errors?.due} />
            : <Input name="due" label="Hạn riêng" type="date" defaultValue={due} min={todayIso()} max={due || undefined} error={errors?.due} />}
        </div>
        <Textarea name="note" label="Lời nhắn" rows={2} maxLength={2000} placeholder="Ví dụ: ưu tiên phần chuẩn đầu ra trước" error={errors?.note} />
        <Actions onClose={onClose} yes="Giao việc" busy={busy} />
      </form>
    </Modal>
  );
}

// ---------------- Trưởng đơn vị tiếp nhận và phân công lại ----------------
function DelegateDialog({ d, a, onClose, onDone, onReject }: { d: TaskDetailDto; a: AssignmentDto; onClose: () => void; onDone: DoneFn; onReject: () => void }) {
  const [opts, setOpts] = useState<AssignOptionsDto | null>(null);
  const { errors, busy, run } = useSubmitter();
  const { toast } = useUi();
  const due = isoDay(a.due);
  const duePassed = !!due && due < todayIso(); // hạn của đơn vị đã qua: không còn ngày hợp lệ để đặt hạn riêng
  useEffect(() => {
    get<AssignOptionsDto>(`/api/cong-viec/lua-chon-giao-viec?assignmentId=${a.id}`).then(setOpts).catch((e) => { toast((e as Error).message, true); onClose(); });
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!opts) {
    return <Modal title="Tiếp nhận và phân công lại" subtitle={`${a.name} · hạn của đơn vị ${fmtDay(a.due)}`} wide onClose={onClose}><Loading /></Modal>;
  }
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void run(async () => {
      const members = [...form.querySelectorAll<HTMLInputElement>('input[name=member]:checked')].map((i) => {
        const role = (form.elements.namedItem(`role-${i.value}`) as HTMLSelectElement).value;
        const due2 = duePassed ? '' : (form.elements.namedItem(`due-${i.value}`) as HTMLInputElement).value;
        return { personId: Number(i.value), role: role ? Number(role) : null, due: due2 || null };
      });
      if (!members.length) return { members: 'Chọn ít nhất một thành viên thực hiện.' };
      const note = (form.elements.namedItem('note') as HTMLTextAreaElement).value;
      const r = await send<{ created: number }>('POST', `/api/phan-cong/${a.id}/phan-cong-lai`, { members, note });
      if (r.errors) return r.errors;
      onDone(`Đã tiếp nhận và giao cho ${r.value.created} thành viên.`, d.summary.id);
    });
  };
  return (
    <Modal title="Tiếp nhận và phân công lại" subtitle={`Giao cho ${a.name} · hạn của đơn vị ${fmtDay(a.due)}`} wide onClose={onClose}>
      <form id="delegate-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="notice"><strong>{d.summary.title}</strong><br /><span className="muted">Giao bởi {a.assigner.name} · ưu tiên {(PRIORITY[d.summary.priority]?.[0] ?? '').toLowerCase()}</span></div>
        <div className="field">
          <label>Chọn thành viên thực hiện *</label>
          <span className="error-text" id="members-error" hidden={!errors?.members}>{errors?.members}</span>
          <div className="table-wrap">
            <table className="pick-table">
              <thead><tr><th /><th>Thành viên</th><th>Vai trò</th><th>Hạn riêng</th></tr></thead>
              <tbody>
                {opts.people.length ? opts.people.map((p) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" name="member" value={p.id} aria-label={`Chọn ${p.name}`} /></td>
                    <td><span className="pick-who"><Avatar initials={p.initials} tone={p.id} /><span><strong>{p.name}</strong><small className={p.openTasks >= 5 ? 'warn-text' : 'muted'}>{p.openTasks} việc đang mở</small></span></span></td>
                    <td><select name={`role-${p.id}`} aria-label={`Vai trò của ${p.name}`}><option value="">—</option><option value="1">Chủ trì</option><option value="2">Phối hợp</option></select></td>
                    <td>{duePassed
                      ? <input type="date" name={`due-${p.id}`} value={due} disabled aria-label={`Hạn riêng của ${p.name} (theo hạn đơn vị)`} />
                      : <input type="date" name={`due-${p.id}`} defaultValue={due} max={due} min={todayIso()} aria-label={`Hạn riêng của ${p.name}`} />}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="muted">Đơn vị chưa có thành viên đang hoạt động.</td></tr>}
              </tbody>
            </table>
          </div>
          <small className={duePassed ? 'warn-text' : 'muted'}>{duePassed
            ? `Hạn của đơn vị (${fmtDay(a.due)}) đã qua: thành viên dùng hạn của đơn vị. Muốn lùi hạn, xin gia hạn với người giao trước.`
            : 'Hạn riêng không được muộn hơn hạn của đơn vị. Đơn vị vẫn chịu trách nhiệm chung và nộp kết quả cho người giao.'}</small>
        </div>
        <Textarea name="note" label="Lời nhắn" rows={2} maxLength={2000} error={errors?.note} />
        <div className="actions form-actions spread">
          {a.actions.canReject ? <button type="button" className="button secondary danger-text" onClick={onReject}>Từ chối nhận…</button> : <span />}
          <span className="actions"><button type="button" className="button secondary" onClick={onClose}>Hủy</button><button className="button" type="submit" disabled={busy}>Tiếp nhận và giao</button></span>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Cập nhật tiến độ ----------------
function ProgressDialog({ d, a, onClose, onDone }: { d: TaskDetailDto; a: AssignmentDto; onClose: () => void; onDone: DoneFn }) {
  const [value, setValue] = useState(pct(a.progress));
  const { errors, busy, run } = useSubmitter();
  const last = a.progressHistory[0];
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get('note') || '').trim();
    void run(async () => {
      if (!note) return { note: 'Ghi lại đã làm được gì trong lần cập nhật này.' };
      const r = await send('POST', `/api/phan-cong/${a.id}/tien-do`, { percent: value, note });
      if (r.errors) return r.errors;
      onDone(`Đã cập nhật tiến độ ${value}%.`, d.summary.id);
    });
  };
  return (
    <Modal title="Cập nhật tiến độ" subtitle={`${d.summary.title}${last ? ` · lần trước ${pct(last.percent)}% (${fmtShort(last.at)})` : ''}`} onClose={onClose}>
      <form id="progress-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="field">
          <label htmlFor="percent">Tiến độ</label>
          <div className="slider-row"><input id="percent" name="percent" type="range" min={0} max={100} step={5} value={value} onChange={(e) => setValue(Number(e.target.value))} aria-describedby="percent-error" /><output id="percent-out" htmlFor="percent">{value}%</output></div>
          <div className="chips static">
            {[10, 25].map((n) => <button key={n} type="button" className="chip" onClick={() => setValue(Math.min(100, value + n))}>+{n}%</button>)}
            <button type="button" className="chip" onClick={() => setValue(100)}>100%</button>
          </div>
          <span className="error-text" id="percent-error" hidden={!errors?.percent}>{errors?.percent}</span>
        </div>
        <Textarea name="note" label="Đã làm được gì *" rows={3} maxLength={2000} required placeholder="Ví dụ: xong chương 1–4, đang soạn phần đánh giá" error={errors?.note} />
        <p className="muted small">Báo 100% chưa phải là nộp kết quả. Khi xong việc, bấm “Nộp kết quả” để người giao duyệt.</p>
        <Actions onClose={onClose} yes="Cập nhật" busy={busy} />
      </form>
    </Modal>
  );
}

// ---------------- Nộp kết quả ----------------
function SubmitDialog({ d, a, onClose, onDone }: { d: TaskDetailDto; a: AssignmentDto; onClose: () => void; onDone: DoneFn }) {
  const { errors, busy, run } = useSubmitter();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const content = String(new FormData(form).get('content') || '').trim();
    const link = String(new FormData(form).get('link') || '').trim();
    const files = [...((form.elements.namedItem('files') as HTMLInputElement).files ?? [])];
    void run(async () => {
      const errs: Record<string, string> = {};
      if (!content) errs.content = 'Mô tả kết quả đã làm được.';
      if (files.length > 10) errs.files = 'Tối đa 10 tệp mỗi lần nộp.';
      const big = files.find((f) => f.size > 20 * 1048576);
      if (big) errs.files = `Tệp “${big.name}” lớn hơn 20 MB.`;
      if (link && !/^https?:\/\//i.test(link)) errs.link = 'Liên kết phải bắt đầu bằng http:// hoặc https://.';
      if (Object.keys(errs).length) return errs;
      const fd = new FormData();
      fd.append('content', content); fd.append('link', link);
      files.forEach((f) => fd.append('files', f, f.name));
      const r = await upload(`/api/phan-cong/${a.id}/ket-qua`, fd);
      if (r.errors) return r.errors;
      onDone('Đã nộp kết quả. Người giao sẽ nhận thông báo để duyệt.', d.summary.id);
    });
  };
  return (
    <Modal title="Nộp kết quả" subtitle={`${d.summary.title} · lần nộp ${a.results.length + 1}`} onClose={onClose}>
      <form id="submit-form" noValidate encType="multipart/form-data" onSubmit={submit}>
        <ErrorSummary errors={errors} />
        {d.criteria ? <div className="notice"><b>Tiêu chí hoàn thành:</b> {d.criteria}</div> : null}
        {a.results[0]?.status === 2 ? <div className="notice warn"><b>Yêu cầu bổ sung:</b> {a.results[0].review?.comment ?? ''}</div> : null}
        <Textarea name="content" label="Mô tả kết quả *" rows={4} maxLength={8000} required error={errors?.content} />
        <Field name="files" label="Tệp đính kèm" help="Tối đa 10 tệp, mỗi tệp 20 MB." error={errors?.files}>
          <input id="files" name="files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.zip,.rar,.7z" aria-describedby="files-error files-help" />
        </Field>
        <Input name="link" label="Liên kết (không bắt buộc)" type="url" placeholder="https://drive.google.com/…" maxLength={1000} error={errors?.link} />
        <div className="notice info">Sau khi nộp, tiến độ chuyển 100% và trạng thái “Chờ duyệt”. Bạn chỉ nộp lại được khi người giao yêu cầu bổ sung.</div>
        <Actions onClose={onClose} yes="Nộp kết quả" busy={busy} />
      </form>
    </Modal>
  );
}

// ---------------- Đánh giá kết quả ----------------
function EvaluateDialog({ a, resultId, onClose, onDone }: { a: AssignmentDto; resultId?: number; onClose: () => void; onDone: (text: string) => void }) {
  const r = a.results.find((x) => x.id === resultId) ?? a.results[0];
  const { errors, busy, run } = useSubmitter();
  if (!r) return null;
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const decision = Number(fd.get('decision') || 1), comment = String(fd.get('comment') || '').trim();
    void run(async () => {
      if (decision !== 1 && !comment) return { comment: 'Nhập nhận xét để người thực hiện biết cần sửa gì.' };
      const res = await send('POST', `/api/ket-qua/${r.id}/danh-gia`, { decision, comment });
      if (res.errors) return res.errors;
      onDone(({ 1: 'Đã duyệt: Đạt.', 2: 'Đã yêu cầu bổ sung.', 3: 'Đã đánh giá: Không đạt.' } as Record<number, string>)[decision]);
    });
  };
  return (
    <Modal title="Đánh giá kết quả" subtitle={`${a.name} · lần nộp ${r.attempt} · ${fmtDay(r.submittedAt)}`} onClose={onClose}>
      <form id="evaluate-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="notice"><p className="prewrap">{r.content}</p>{r.files.length ? <FileList files={r.files} /> : null}</div>
        <Field name="decision" label="Quyết định *"><Seg name="decision" items={[['1', 'Đạt'], ['2', 'Cần bổ sung'], ['3', 'Không đạt']]} value="1" /></Field>
        <Textarea name="comment" label="Nhận xét" rows={3} maxLength={4000} placeholder="Bắt buộc khi chọn Cần bổ sung hoặc Không đạt" error={errors?.comment} />
        <Actions onClose={onClose} yes="Lưu đánh giá" busy={busy} />
      </form>
    </Modal>
  );
}

// ---------------- Xin gia hạn / duyệt gia hạn ----------------
function ExtensionDialog({ d, a, onClose, onDone }: { d: TaskDetailDto; a: AssignmentDto; onClose: () => void; onDone: DoneFn }) {
  const { errors, busy, run } = useSubmitter();
  const minDay = addDaysIso(isoDay(a.due), 1);
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const proposedDue = String(fd.get('proposedDue') || ''), reason = String(fd.get('reason') || '').trim();
    void run(async () => {
      const errs: Record<string, string> = {};
      if (!proposedDue) errs.proposedDue = 'Chọn hạn đề xuất.';
      if (!reason) errs.reason = 'Nhập lý do xin gia hạn.';
      if (Object.keys(errs).length) return errs;
      const r = await send('POST', `/api/phan-cong/${a.id}/gia-han`, { proposedDue, reason });
      if (r.errors) return r.errors;
      onDone('Đã gửi yêu cầu gia hạn. Hạn cũ vẫn tính cho tới khi được duyệt.', d.summary.id);
    });
  };
  return (
    <Modal title="Xin gia hạn" subtitle={`${d.summary.title} · giao bởi ${a.assigner.name}`} onClose={onClose}>
      <form id="extension-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="due-compare">
          <dl className="kv"><dt>Hạn hiện tại</dt><dd>{fmtDay(a.due)}</dd></dl><span aria-hidden="true">→</span>
          <Input name="proposedDue" label="Hạn đề xuất *" type="date" defaultValue={addDaysIso(isoDay(a.due), 3)} min={minDay} required error={errors?.proposedDue} />
        </div>
        <Textarea name="reason" label="Lý do *" rows={3} maxLength={1000} required error={errors?.reason} />
        <p className="muted small">Tiến độ hiện tại: {pct(a.progress)}% · đã được gia hạn {a.approvedExtensions}/2 lần.</p>
        <div className="notice">Trong lúc chờ duyệt, hạn cũ vẫn được tính. Mỗi phân công được gia hạn tối đa 2 lần.</div>
        <Actions onClose={onClose} yes="Gửi yêu cầu" busy={busy} />
      </form>
    </Modal>
  );
}

function DecideDialog({ d, a, extensionId, onClose, onDone }: { d: TaskDetailDto; a: AssignmentDto; extensionId?: number; onClose: () => void; onDone: DoneFn }) {
  const x = a.extensions.find((e) => e.id === extensionId) ?? a.extensions.find((e) => e.status === 0);
  const [decision, setDecision] = useState('approve');
  const { errors, busy, run } = useSubmitter();
  if (!x) return null;
  const beyond = d.summary.due && toDate(x.proposedDue) > toDate(d.summary.due);
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const comment = String(fd.get('comment') || '').trim(), approvedDue = String(fd.get('approvedDue') || '') || null;
    void run(async () => {
      if (decision !== 'approve' && !comment) return { comment: decision === 'reject' ? 'Nhập lý do từ chối.' : 'Nhập nhận xét khi duyệt hạn khác với đề xuất.' };
      const r = await send('POST', `/api/gia-han/${x.id}/duyet`, { decision, approvedDue, comment });
      if (r.errors) return r.errors;
      onDone(decision === 'reject' ? 'Đã từ chối yêu cầu gia hạn.' : 'Đã duyệt gia hạn. Hạn mới đã được cập nhật.', d.summary.id);
    });
  };
  return (
    <Modal title="Yêu cầu gia hạn" subtitle={`${x.requestedBy.name} · gửi ${relative(x.createdAt)} · lần xin thứ ${a.extensions.length}`} onClose={onClose}>
      <form id="decide-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="due-compare">
          <dl className="kv"><dt>Hạn hiện tại</dt><dd>{fmtDay(x.oldDue)}</dd></dl><span aria-hidden="true">→</span>
          <dl className="kv warn"><dt>Đề xuất</dt><dd>{fmtDay(x.proposedDue)} · +{Math.round((toDate(x.proposedDue).getTime() - toDate(x.oldDue).getTime()) / DAY)} ngày</dd></dl>
        </div>
        <div className="field"><label>Lý do</label><p className="prewrap">{x.reason}</p><small className="muted">Tiến độ {pct(a.progress)}%{a.progressHistory[0] ? ' · cập nhật ' + fmtShort(a.progressHistory[0].at) : ''}</small></div>
        {beyond ? <div className="notice warn">Hạn đề xuất muộn hơn hạn chung của công việc ({fmtDay(d.summary.due)}). Nếu đồng ý, hạn chung sẽ lùi theo.</div> : null}
        <Field name="decision" label="Quyết định *"><Seg name="decision" items={[['approve', 'Đồng ý'], ['approve-other', 'Đồng ý với hạn khác'], ['reject', 'Từ chối']]} value={decision} onChange={setDecision} /></Field>
        <div id="other-due" hidden={decision !== 'approve-other'}>
          <Input name="approvedDue" label="Hạn mới được duyệt" type="date" defaultValue={isoDay(x.proposedDue)} min={addDaysIso(isoDay(x.oldDue), 1)} error={errors?.approvedDue} />
        </div>
        <Textarea name="comment" label="Nhận xét" rows={2} maxLength={1000} placeholder="Bắt buộc khi từ chối hoặc đổi sang hạn khác" error={errors?.comment} />
        <Actions onClose={onClose} yes="Lưu quyết định" busy={busy} cancel="Để sau" />
      </form>
    </Modal>
  );
}

// ---------------- Duyệt xin từ chối (việc đã tiếp nhận) ----------------
function DeclineDecideDialog({ d, a, declineId, onClose, onDone }: { d: TaskDetailDto; a: AssignmentDto; declineId?: number; onClose: () => void; onDone: DoneFn }) {
  const x = a.declines.find((e) => e.id === declineId) ?? a.declines.find((e) => e.status === 0);
  const [decision, setDecision] = useState('approve');
  const { errors, busy, run } = useSubmitter();
  if (!x) return null;
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const comment = String(new FormData(e.currentTarget).get('comment') || '').trim();
    void run(async () => {
      if (decision === 'reject' && !comment) return { comment: 'Nhập lý do không đồng ý để người nhận biết.' };
      const r = await send('POST', `/api/xin-tu-choi/${x.id}/duyet`, { decision, comment });
      if (r.errors) return r.errors;
      onDone(decision === 'approve' ? `Đã đồng ý cho ${x.requestedBy.name} thôi nhận việc. Có thể giao cho người khác.` : 'Đã không đồng ý. Người nhận tiếp tục thực hiện.', d.summary.id);
    });
  };
  return (
    <Modal title="Yêu cầu xin từ chối việc" subtitle={`${x.requestedBy.name} · gửi ${relative(x.createdAt)}`} onClose={onClose}>
      <form id="decline-decide-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className="field"><label>Lý do</label><p className="prewrap">{x.reason}</p><small className="muted">Đã tiếp nhận {a.acceptedAt ? fmtShort(a.acceptedAt) : ''} · tiến độ {pct(a.progress)}% · hạn riêng {fmtDay(a.due)}</small></div>
        <Field name="decision" label="Quyết định *"><Seg name="decision" items={[['approve', 'Đồng ý cho thôi'], ['reject', 'Không đồng ý']]} value={decision} onChange={setDecision} /></Field>
        {decision === 'approve' ? <div className="notice">Phân công chuyển sang “Từ chối”. Tiến độ và lịch sử vẫn được giữ; bạn có thể giao việc cho người khác.</div> : null}
        <Textarea name="comment" label={decision === 'reject' ? 'Lý do không đồng ý *' : 'Nhận xét'} rows={2} maxLength={1000} placeholder={decision === 'reject' ? 'Ví dụ: việc gấp, chưa có người thay; hỗ trợ thêm phần …' : 'Không bắt buộc'} error={errors?.comment} />
        <Actions onClose={onClose} yes="Lưu quyết định" busy={busy} cancel="Để sau" />
      </form>
    </Modal>
  );
}

// ---------------- Lý do: từ chối nhận việc, xin từ chối, hủy phân công, tạm dừng / hủy công việc ----------------
function ReasonDialog({ req, d, a, onClose, onDone }: { req: DialogRequest; d: TaskDetailDto; a?: AssignmentDto; onClose: () => void; onDone: DoneFn }) {
  const { errors, busy, run } = useSubmitter();
  const s = req.status;
  const opts = req.kind === 'reject'
    ? { title: 'Từ chối nhận việc', subtitle: a?.name ?? '', label: 'Lý do từ chối *', yes: 'Từ chối', danger: true, field: 'reason', required: true, message: 'Người giao sẽ nhận được lý do và có thể giao cho người khác.' }
    : req.kind === 'decline-request'
    ? { title: 'Xin từ chối việc đã nhận', subtitle: d.summary.title, label: 'Lý do xin từ chối *', yes: 'Gửi yêu cầu', danger: true, field: 'reason', required: true, message: 'Bạn đã tiếp nhận việc này nên cần người giao đồng ý. Trong lúc chờ duyệt, bạn vẫn là người thực hiện.' }
    : req.kind === 'cancel-assignment'
      ? { title: 'Hủy phân công', subtitle: a?.name ?? '', label: 'Lý do hủy *', yes: 'Hủy phân công', danger: true, field: 'reason', required: true, message: 'Người nhận sẽ được thông báo. Lịch sử và kết quả đã nộp vẫn được giữ.' }
      : { title: s === 'cancel' ? 'Hủy công việc' : 'Tạm dừng công việc', subtitle: d.summary.title, label: s === 'cancel' ? 'Lý do hủy *' : 'Lý do tạm dừng', yes: s === 'cancel' ? 'Hủy công việc' : 'Tạm dừng', danger: s === 'cancel', field: 'note', required: s === 'cancel', message: s === 'cancel' ? 'Mọi phân công đang mở sẽ bị hủy. Không hoàn tác được.' : 'Người nhận không cập nhật tiến độ được cho đến khi tiếp tục.' };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get(opts.field) || '').trim();
    void run(async () => {
      if (opts.required && !text) return { [opts.field]: 'Nhập lý do.' };
      if (req.kind === 'status') {
        const r = await send('POST', `/api/cong-viec/${d.summary.id}/trang-thai`, { action: s, note: text });
        if (r.errors) return r.errors;
        onDone(STATUS_DONE[s!], d.summary.id);
        return;
      }
      const path = req.kind === 'reject' ? 'tu-choi' : req.kind === 'decline-request' ? 'xin-tu-choi' : 'huy';
      const r = await send('POST', `/api/phan-cong/${req.assignmentId}/${path}`, { reason: text });
      if (r.errors) return r.errors;
      onDone(req.kind === 'reject' ? 'Đã từ chối nhận việc.' : req.kind === 'decline-request' ? 'Đã gửi yêu cầu xin từ chối. Người giao sẽ xem xét.' : 'Đã hủy phân công.', d.summary.id);
    });
  };
  return (
    <Modal title={opts.title} subtitle={opts.subtitle} onClose={onClose}>
      <form id="reason-form" noValidate onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <p>{opts.message}</p>
        <Textarea name={opts.field} label={opts.label} rows={3} maxLength={1000} required={opts.required} error={errors?.[opts.field]} />
        <Actions onClose={onClose} yes={opts.yes} danger={opts.danger} busy={busy} cancel="Quay lại" />
      </form>
    </Modal>
  );
}
