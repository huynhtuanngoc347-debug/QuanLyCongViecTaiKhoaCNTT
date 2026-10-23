import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssignmentDto, CommentDto, DeclineDto, FileDto, HistoryDto, TaskDetailDto } from '@khoa/shared';
import { ApiError, get, openFile, send, upload } from '../api/client';
import { Glyph } from '../ui/glyph';
import { A_STATUS, Avatar, Badge, Bar, ButtonLink, Empty, Loading, Prio, RESULT, ROLE, STATUS, useUi } from '../ui/ui';
import { dueInfo, fmtDay, fmtTime, kb, pct, relative, toDate } from '../format';
import { useTitle } from '../pages/common';
import { hashOf, useTaskDetail } from './queries';
import { useTaskActions } from './dialogs';
import { useSession } from '../session';
import { useIsMobile } from '../ui/useIsMobile';
import { useDesktopFirst } from '../ui/DesktopFirst';
import { closeDialog } from '../motion';

/** Định dạng xem trực tiếp được trong trình duyệt (máy chủ trả inline khi ?xem=1). */
const VIEWABLE = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.txt'];
const extOf = (name: string) => (name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
/** Định dạng được đính kèm (khớp ALLOWED_EXTENSIONS ở máy chủ). */
export const COMMENT_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.rar', '.7z'];

export const FileList = ({ files }: { files: FileDto[] }) =>
  files.length ? (
    <div className="file-list">
      {files.map((f) => f.downloadable ? (
        <span key={f.id} className="file-card">
          <Glyph name="paperclip" size={15} />
          <span className="file-card-name"><strong title={f.name}>{f.name}</strong><small className="muted">{extOf(f.name).slice(1).toUpperCase()} · {kb(f.size)} · {fmtDay(f.uploadedAt)}</small></span>
          {VIEWABLE.includes(extOf(f.name)) ? <a className="file-act" href={`./api/tep/${f.id}?xem=1`} target="_blank" rel="noopener noreferrer" aria-label={`Xem trước ${f.name}`} onClick={(e) => { e.preventDefault(); void openFile(`./api/tep/${f.id}?xem=1`, true); }}><Glyph name="eye" size={15} />Xem</a> : null}
          <a className="file-act" href={`./api/tep/${f.id}`} download aria-label={`Tải về ${f.name}`} onClick={(e) => { e.preventDefault(); void openFile(`./api/tep/${f.id}`, false); }}><Glyph name="download" size={15} />Tải về</a>
        </span>
      ) : <span key={f.id} className="file-chip" title="Dữ liệu mẫu: chưa có tệp thật">{f.name}</span>)}
    </div>
  ) : <p className="muted">Không có tệp.</p>;
const CommentFiles = FileList;

/**
 * Văn bản dài (mô tả, tiêu chí, nội dung kết quả): giữ nguyên toàn bộ, chỉ thu gọn hiển thị khi quá dài,
 * bấm "Xem thêm" để đọc đủ. Văn bản ngắn hiện bình thường.
 */
function LongText({ text, lines = 8 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 520 || text.split('\n').length > lines;
  return (
    <div className="long-text">
      <p className={`prewrap ${long && !open ? 'clamped' : ''}`} style={long && !open ? { WebkitLineClamp: lines } : undefined}>{text}</p>
      {long ? <button type="button" className="link-button small more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : 'Xem thêm'}</button> : null}
    </div>
  );
}
const Multiline = ({ text }: { text: string }) => (text ? <LongText text={text} /> : <p className="muted">Chưa có.</p>);
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="card card-pad stack"><h3>{title}</h3>{children}</section>;

/** page: lỗi thay cho cả trang → tiêu đề là h1 #page-title (trang luôn có một h1). */
export function Failed({ error, onRetry, page }: { error: unknown; onRetry?: () => void; page?: boolean }) {
  const e = error as ApiError;
  const H = page ? 'h1' : 'h2';
  const hProps = page ? { id: 'page-title', tabIndex: -1 } : {};
  if (e?.status === 403 || e?.status === 404) {
    return <div className="card card-pad stack"><H {...hProps}>{e.status === 403 ? 'Không có quyền' : 'Không tìm thấy'}</H><p className="muted">{e.message}</p><ButtonLink to="/cong-viec" kind="secondary">Về danh sách công việc</ButtonLink></div>;
  }
  // Lỗi nhập liệu (400): hiện đúng thông báo của trường lỗi thay cho câu chung "kiểm tra các trường được đánh dấu".
  const detail = e?.errors ? Object.values(e.errors)[0] : e?.message;
  return <div className="card card-pad stack" role="alert"><H {...hProps}>Không tải được dữ liệu</H><p className="muted">{detail || 'Lỗi không xác định.'}</p>{onRetry ? <div className="actions"><button className="button secondary" onClick={onRetry}>Thử lại</button></div> : null}</div>;
}

const HISTORY: Record<string, string> = { TaoCongViec: 'tạo công việc', GiaoViec: 'giao việc', TiepNhan: 'tiếp nhận', TuChoi: 'từ chối', PhanCongLai: 'phân công lại', CapNhatTienDo: 'cập nhật tiến độ', NopKetQua: 'nộp kết quả', DuyetKetQua: 'đánh giá kết quả', XinGiaHan: 'xin gia hạn', DuyetGiaHan: 'duyệt gia hạn', HuyPhanCong: 'hủy phân công', XinTuChoi: 'xin từ chối', DuyetTuChoi: 'duyệt xin từ chối', DinhKemTep: 'đính kèm tệp', XoaTep: 'gỡ tệp', BinhLuan: 'bình luận', DoiTrangThai: 'đổi trạng thái', CapNhatCongViec: 'sửa công việc', GhiChu: 'ghi chú' };
const HISTORY_GROUP: Record<string, string[]> = { progress: ['CapNhatTienDo'], assign: ['GiaoViec', 'TiepNhan', 'TuChoi', 'XinTuChoi', 'DuyetTuChoi', 'PhanCongLai', 'HuyPhanCong'], due: ['XinGiaHan', 'DuyetGiaHan'], result: ['NopKetQua', 'DuyetKetQua'], status: ['DoiTrangThai', 'TaoCongViec', 'GhiChu', 'CapNhatCongViec', 'DinhKemTep', 'XoaTep'] };
const FIELD_LABEL: Record<string, string> = { TrangThai: 'trạng thái', HanHoanThanh: 'hạn hoàn thành', TieuDe: 'tiêu đề', MoTa: 'mô tả', TieuChiHoanThanh: 'tiêu chí', MucDoUuTien: 'ưu tiên', PhanTramTienDo: 'tiến độ', NgayBatDau: 'ngày bắt đầu', MaDonViQuanLy: 'đơn vị quản lý', MaTheLoai: 'thể loại', MaCongViecCha: 'công việc cha', NgayHoanThanh: 'ngày hoàn thành', TrangThaiNop: 'kết quả' };

function OverviewTab({ d }: { d: TaskDetailDto }) {
  const t = d.summary;
  const info: [string, React.ReactNode][] = ([
    // Đơn vị, người tạo, hạn, thể loại đã có ở đầu trang: ở đây chỉ còn thông tin không lặp.
    ['Ngày bắt đầu', t.start ? fmtDay(t.start) : 'Chưa đặt'],
    ['Công việc cha', d.parent ? <Link to={`/cong-viec/chi-tiet?id=${d.parent.id}`}>{d.parent.title}</Link> : null],
    ['Phải xong trước', d.dependsOn.length ? d.dependsOn.map((x, i) => <span key={x.id}>{i ? <br /> : null}<Link to={`/cong-viec/chi-tiet?id=${x.id}`}>{x.title}</Link> <Badge map={STATUS} value={x.status} /></span>) : null],
    ['Công việc con', d.children.length ? d.children.map((x, i) => <span key={x.id}>{i ? <br /> : null}<Link to={`/cong-viec/chi-tiet?id=${x.id}`}>{x.title}</Link> <Badge map={STATUS} value={x.status} /></span>) : null],
    ['Tạo từ mẫu', d.templateId ? `Mẫu số ${d.templateId}` : null],
  ] as [string, React.ReactNode][]).filter(([, v]) => v !== null);
  const recent = d.assignments.flatMap((a) => a.progressHistory.map((p) => ({ ...p, who: a.name }))).sort((a, b) => toDate(b.at).getTime() - toDate(a.at).getTime()).slice(0, 6);
  return (
    <div className="detail-grid">
      <div className="stack">
        <section className="card card-pad content-card">
          <div className="content-sec"><h3>Mô tả</h3><Multiline text={d.description} /></div>
          <div className="content-sec"><h3>Tiêu chí hoàn thành</h3><Multiline text={d.criteria} /></div>
          <div className="content-sec"><h3>Tệp đính kèm</h3><FileList files={d.files} /></div>
        </section>
      </div>
      <div className="stack">
        <Block title="Thông tin thêm"><dl className="info-list">{info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Block>
        <Block title="Tiến độ gần đây">
          {recent.length ? <ul className="mini-timeline">{recent.map((p) => <li key={p.id}><b>{pct(p.percent)}%</b><div><span>{p.note}</span><small className="muted">{p.by.name} · {relative(p.at)}</small></div></li>)}</ul> : <p className="muted">Chưa có báo cáo tiến độ.</p>}
        </Block>
      </div>
    </div>
  );
}

function AssignmentButtons({ a, d }: { a: AssignmentDto; d: TaskDetailDto }) {
  const actions = useTaskActions();
  const desk = useDesktopFirst();
  const taskId = d.summary.id;
  // Điện thoại: thao tác đã có ở thanh ghim đáy màn hình (MobileActionBar chọn phân công đầu tiên có thao tác đó) thì không lặp trong thẻ.
  const inBar = (k: keyof AssignmentDto['actions']) => desk.mobile && d.assignments.find((y) => y.actions[k])?.id === a.id;
  const x = Object.fromEntries(Object.entries(a.actions).map(([k, v]) => [k, v && !(['canAccept', 'canUpdateProgress', 'canSubmit', 'canEvaluate', 'canDecideExtension', 'canDecideDecline'].includes(k) && inBar(k as keyof AssignmentDto['actions']))])) as AssignmentDto['actions'];
  const open = (kind: Parameters<typeof actions.open>[0]['kind'], extra: object = {}) => actions.open({ kind, taskId, assignmentId: a.id, ...extra });
  return (
    <>
      {x.canAccept ? <button className="button small" onClick={() => void actions.accept(taskId, a.id)}>Tiếp nhận</button> : null}
      {x.canDelegate ? <button className="button small" onClick={() => desk.guard('Phân công lại cho thành viên', () => open('delegate'))}>Phân công lại</button> : null}
      {x.canReject ? <button className="button small secondary" onClick={() => open('reject')}>Xin từ chối</button> : null}
      {x.canUpdateProgress ? <button className="button small" onClick={() => open('progress')}>Cập nhật tiến độ</button> : null}
      {x.canSubmit ? <button className="button small secondary" onClick={() => open('submit')}>Nộp kết quả</button> : null}
      {x.canRequestExtension ? <button className="button small secondary" onClick={() => open('extension')}>Xin gia hạn</button> : null}
      {x.canEvaluate ? <button className="button small" onClick={() => open('evaluate', { resultId: a.results[0]?.id })}>Đánh giá kết quả</button> : null}
      {x.canDecideExtension ? <button className="button small" onClick={() => open('decide', { extensionId: a.extensions.find((e) => e.status === 0)?.id })}>Duyệt gia hạn</button> : null}
      {x.canDecideDecline ? <button className="button small" onClick={() => open('decline-decide', { declineId: a.declines.find((e) => e.status === 0)?.id })}>Duyệt xin từ chối</button> : null}
      {x.canRequestDecline ? <button className="button small ghost danger-text" onClick={() => open('decline-request')}>Xin từ chối</button> : null}
      {x.canRemind ? <button className="button small ghost" onClick={() => void actions.remind(a.id)}>Nhắc</button> : null}
      {x.canCancel ? <button className="button small ghost danger-text" onClick={() => open('cancel-assignment')}>Hủy phân công</button> : null}
      {desk.node}
    </>
  );
}

function AssignTab({ d }: { d: TaskDetailDto }) {
  const actions = useTaskActions();
  const me = useSession().session?.user.id;
  if (!d.assignments.length) {
    return <div className="card"><Empty title="Chưa giao cho ai" description={d.permissions.canAssign ? 'Bấm “+ Giao việc” để giao cho cá nhân hoặc cả đơn vị.' : d.summary.status === 0 ? 'Tạo chính thức bản nháp trước khi giao việc.' : 'Người quản lý công việc sẽ giao việc.'}
      action={d.permissions.canAssign ? <button className="button" onClick={() => actions.open({ kind: 'assign', taskId: d.summary.id })}>+ Giao việc</button> : undefined} /></div>;
  }
  const byAssigned = (a: AssignmentDto, b: AssignmentDto) => toDate(a.assignedAt).getTime() - toDate(b.assignedAt).getTime();
  const open = d.assignments.filter((a) => a.status < 5).sort(byAssigned);
  // Từ chối / hủy: gom thành danh sách gọn, mới nhất trước, để giao lại nhiều lần không làm trang dài ra.
  const closed = d.assignments.filter((a) => a.status >= 5).sort((a, b) => b.id - a.id);
  return (
    <div className="stack">
      {open.map((a) => {
        const last = a.progressHistory[0], ext = a.extensions.find((e) => e.status === 0);
        const decl = a.declines.find((e) => e.status === 0), lastDecl = a.declines[0];
        const due = dueInfo(a.due, [0, 1, 2].includes(a.status) && [1, 2].includes(d.summary.status));
        return (
          <article key={a.id} className={`card assign-card ${a.status >= 5 ? 'closed' : ''}`} id={`assignment-${a.id}`}>
            <div className="assign-who"><Avatar initials={a.initials} tone={a.personId ?? a.unitId ?? 0} /><div><strong>{a.name}</strong><small className="muted">{[a.kind === 'unit' ? 'Giao cho cả đơn vị' : '', a.role ? ROLE[a.role] : '', `giao bởi ${a.assigner.name}`].filter(Boolean).join(' · ')}</small></div></div>
            <div className="assign-state"><Badge map={A_STATUS} value={a.status} /><small className={`due ${due.cls}`}>Hạn riêng {due.text}</small>{a.approvedExtensions ? <small className="muted">Đã gia hạn {a.approvedExtensions} lần</small> : null}</div>
            {decl ? <DeclinePending a={a} decl={decl} me={me} />
              : <div className="assign-progress"><span className="progress-cell"><Bar value={a.progress} tone={a.status === 4 ? 'green' : a.overdue ? 'orange' : ''} /><span className="muted small">{pct(a.progress)}%</span></span><small className="muted">{last ? `${last.note} · ${relative(last.at)}` : a.note ? 'Lời nhắn: ' + a.note : 'Chưa có báo cáo tiến độ.'}</small></div>}
            <div className="assign-actions actions wrap"><AssignmentButtons a={a} d={d} /></div>
            {ext ? <div className="ext-box"><strong>Xin gia hạn đến {fmtDay(ext.proposedDue)}</strong> (hạn hiện tại {fmtDay(ext.oldDue)}) · {ext.requestedBy.name}, {relative(ext.createdAt)}<p>{ext.reason}</p></div> : null}
            {/* Người nhận tự tiếp nhận thì yêu cầu được đóng bởi chính họ: không hiện như người giao từ chối. */}
            {!decl && lastDecl?.status === 2 && lastDecl.decidedBy && lastDecl.decidedBy.id !== lastDecl.requestedBy.id && [1, 2].includes(a.status) ? <div className="ext-box decline-box muted-box"><strong>Không đồng ý cho từ chối</strong> · {lastDecl.decidedBy.name}, {relative(lastDecl.decidedAt ?? lastDecl.createdAt)}<p>{lastDecl.comment}</p></div> : null}
          </article>
        );
      })}
      {closed.length ? (
        <details className="card closed-assignments" open={!open.length}>
          <summary>Phân công đã đóng ({closed.length}) <small className="muted">từ chối hoặc đã hủy</small></summary>
          <ul>
            {closed.map((a) => <li key={a.id} id={`assignment-${a.id}`}><ClosedAssignment a={a} /></li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Yêu cầu xin từ chối đang chờ: thay cột tiến độ, lời lẽ theo người đang xem (người duyệt / người xin / người khác). */
function DeclinePending({ a, decl, me }: { a: AssignmentDto; decl: DeclineDto; me?: number }) {
  const beforeAccept = a.status === 0;
  const mine = decl.requestedBy.id === me;
  const waitFor = a.actions.canDecideDecline ? 'chờ bạn duyệt' : `chờ ${a.assigner.name} duyệt`;
  return (
    <div className="decline-pending" role="status">
      <strong>{mine ? `Bạn đã xin ${beforeAccept ? 'từ chối nhận việc' : 'thôi nhận việc'}` : `${decl.requestedBy.name} xin ${beforeAccept ? 'từ chối nhận việc' : 'thôi nhận việc'}`}</strong>
      <small>Gửi {relative(decl.createdAt)} · {waitFor}</small>
      <p><span className="muted">Lý do:</span> {decl.reason}</p>
      {mine && !beforeAccept ? <small className="muted">Trong lúc chờ, bạn vẫn là người thực hiện việc này.</small> : null}
    </div>
  );
}

/** Một dòng gọn cho phân công đã từ chối / hủy. */
function ClosedAssignment({ a }: { a: AssignmentDto }) {
  const decl = a.declines.find((e) => e.status === 1);
  // Xin trước khi tiếp nhận là "từ chối nhận việc"; sau khi đã nhận là "thôi nhận việc".
  const beforeAccept = decl && (!a.acceptedAt || toDate(decl.createdAt) < toDate(a.acceptedAt));
  const label = a.status === 6 ? 'Đã hủy phân công'
    : decl ? `${decl.decidedBy?.name ?? 'Người giao'} đồng ý cho ${beforeAccept ? 'từ chối nhận việc' : 'thôi nhận việc'}`
    : 'Từ chối nhận việc';
  return (
    <>
      <div className="closed-head"><strong>{a.name}</strong><Badge map={A_STATUS} value={a.status} /><small className="muted">giao {fmtDay(a.assignedAt)} bởi {a.assigner.name}</small></div>
      <p className="muted small">{label}{decl?.decidedAt ? ` · ${relative(decl.decidedAt)}` : ''}{decl ? <> · Lý do xin: {decl.reason}</> : null}</p>
    </>
  );
}

function ResultTab({ d }: { d: TaskDetailDto }) {
  const actions = useTaskActions();
  if (!d.assignments.length) return <div className="card"><Empty title="Chưa có phân công" description="Kết quả được nộp theo từng phân công." /></div>;
  const all = d.assignments.flatMap((a) => a.results);
  const counts: [string, number][] = [['Đạt', all.filter((r) => r.status === 1).length], ['Chờ duyệt', all.filter((r) => r.status === 0).length], ['Cần bổ sung', all.filter((r) => r.status === 2).length], ['Không đạt', all.filter((r) => r.status === 3).length], ['Chưa nộp', d.assignments.filter((a) => a.status < 5 && !a.results.length).length]];
  return (
    <>
      <div className="chips static">{counts.map(([l, n]) => <span key={l} className={`chip ${l === 'Chờ duyệt' && n ? 'warn' : ''}`}>{l} · {n}</span>)}</div>
      <div className="stack">
        {d.assignments.filter((a) => a.status < 5 || a.results.length).map((a) => (
          <article key={a.id} className="card card-pad stack">
            <div className="result-head"><Avatar initials={a.initials} tone={a.personId ?? a.unitId ?? 0} /><div><strong>{a.name}</strong>{a.kind === 'unit' ? <small className="muted">Giao cho cả đơn vị</small> : null}</div><Badge map={A_STATUS} value={a.status} /></div>
            {a.results.length ? a.results.map((r, i) => (
              <div key={r.id} className="result-row">
                <div><strong>Lần {r.attempt}</strong><small className="muted">{fmtDay(r.submittedAt)} {fmtTime(r.submittedAt)}</small></div>
                <div className="stack-sm">
                  <Badge map={RESULT} value={r.status} />
                  <LongText text={r.content} lines={6} />
                  {r.files.length ? <FileList files={r.files} /> : null}
                  {r.review ? <div className="review-box"><Badge map={RESULT} value={r.review.decision} /><span><b>{r.review.reviewer.name}:</b> {r.review.comment || 'Không có nhận xét.'}</span></div> : null}
                </div>
                <div>{i === 0 && a.actions.canEvaluate && r.status === 0 ? <button className="button small" onClick={() => actions.open({ kind: 'evaluate', taskId: d.summary.id, assignmentId: a.id, resultId: r.id })}>Đánh giá</button> : null}</div>
              </div>
            )) : <p className="muted">Chưa nộp kết quả.</p>}
          </article>
        ))}
      </div>
    </>
  );
}

function DiscussTab({ d }: { d: TaskDetailDto }) {
  const id = d.summary.id;
  const q = useQuery({ queryKey: ['comments', id], queryFn: () => get<CommentDto[]>(`/api/cong-viec/${id}/binh-luan`), staleTime: 10_000 });
  const qc = useQueryClient();
  const { toast } = useUi();
  // replyTo: luồng (bình luận gốc) + bình luận đang được trả lời (có thể là một câu trả lời trong luồng).
  const [replyTo, setReplyTo] = useState<{ root: number; to: CommentDto } | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!q.data && q.error) return <Failed error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading title="Đang tải thảo luận…" />;
  const all = q.data;
  const top = all.filter((c) => !c.parentId), replies = (pid: number) => all.filter((c) => c.parentId === pid);
  const byId = new Map(all.map((c) => [c.id, c]));
  // Trả lời trong luồng lưu dạng "@Tên " ở đầu nội dung (không đổi CSDL): tách ra để hiện "trả lời Tên".
  const mentionOf = (c: CommentDto) => {
    if (!c.content.startsWith('@')) return null;
    const names = [...new Set(all.map((x) => x.author.name))].sort((a, b) => b.length - a.length);
    return names.find((n) => c.content.startsWith(`@${n} `) || c.content === `@${n}`) ?? null;
  };
  const jump = (cid: number) => {
    const el = document.getElementById(`comment-${cid}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('flash'); window.setTimeout(() => el?.classList.remove('flash'), 1400);
  };
  const startReply = (c: CommentDto) => {
    setReplyTo({ root: c.parentId ?? c.id, to: c });
    window.setTimeout(() => document.getElementById('comment-content')?.focus(), 0);
  };
  const One = ({ c, reply = false }: { c: CommentDto; reply?: boolean }) => {
    const mention = reply ? mentionOf(c) : null;
    const target = reply ? (mention ? all.find((x) => x.author.name === mention && x.id !== c.id && (x.id === c.parentId || x.parentId === c.parentId)) : byId.get(c.parentId!)) : null;
    const targetName = mention ?? target?.author.name;
    const text = mention ? c.content.slice(mention.length + 1).trimStart() : c.content;
    return (
      <div className={`comment ${reply ? 'reply' : ''} ${replyTo?.to.id === c.id ? 'replying' : ''}`} id={`comment-${c.id}`}>
        <Avatar initials={c.author.initials} tone={c.author.id} />
        <div className="bubble">
          <div className="bubble-head">
            <b>{c.author.name}</b>
            {reply && targetName ? <button type="button" className="reply-to" onClick={() => target && jump(target.id)} title="Xem bình luận được trả lời"><Glyph name="reply" size={13} />trả lời <b>{targetName}</b></button> : null}
            <span className="muted small">{relative(c.createdAt)}</span>
          </div>
          {text && text !== '(Gửi tệp đính kèm)' ? <p className="prewrap">{text}</p> : null}
          {c.files.length ? <CommentFiles files={c.files} /> : null}
          {d.permissions.canComment ? <button className="link-button small reply-btn" onClick={() => startReply(c)}><Glyph name="reply" size={14} />Trả lời</button> : null}
        </div>
      </div>
    );
  };
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const bad = next.find((f) => !COMMENT_EXT.includes((f.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()));
    if (bad) { toast(`Không nhận tệp “${bad.name}”. Chỉ nhận: ${COMMENT_EXT.join(', ')}.`, true); return; }
    const big = next.find((f) => f.size > 20 * 1024 * 1024);
    if (big) { toast(`Tệp “${big.name}” lớn hơn 20 MB.`, true); return; }
    if (next.length > 10) { toast('Tối đa 10 tệp mỗi bình luận.', true); return; }
    setFiles(next);
  };
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!content.trim() && !files.length) { toast('Nhập nội dung hoặc đính kèm tệp.', true); return; }
    // Trả lời một câu trả lời trong luồng: ghi "@Tên" để mọi người biết đang trả lời ai.
    const to = replyTo?.to;
    const prefix = to && to.id !== replyTo!.root && !content.trim().startsWith(`@${to.author.name}`) ? `@${to.author.name} ` : '';
    const text = prefix + content.trim();
    setBusy(true);
    try {
      let r;
      if (files.length) {
        const fd = new FormData();
        fd.append('content', text);
        if (replyTo) { fd.append('parentId', String(replyTo.root)); fd.append('replyToId', String(replyTo.to.author.id)); }
        files.forEach((f) => fd.append('files', f));
        r = await upload(`/api/cong-viec/${id}/binh-luan`, fd);
      } else {
        r = await send('POST', `/api/cong-viec/${id}/binh-luan`, { content: text, parentId: replyTo?.root ?? null, replyToId: replyTo?.to.author.id ?? null });
      }
      if (r.errors) { toast(Object.values(r.errors)[0], true); return; }
      setContent(''); setReplyTo(null); setFiles([]);
      void qc.invalidateQueries({ queryKey: ['comments', id] });
      void qc.invalidateQueries({ queryKey: ['history', id] });
      toast(to ? `Đã trả lời ${to.author.name}.` : 'Đã gửi bình luận.');
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="stack comments">
      {top.length ? top.map((c) => <div key={c.id} className="thread"><One c={c} />{replies(c.id).map((r) => <One key={r.id} c={r} reply />)}</div>)
        : <div className="card"><Empty title="Chưa có thảo luận" description="Trao đổi về công việc tại đây; mọi người liên quan sẽ nhận thông báo." /></div>}
      {d.permissions.canComment ? (
        <form id="comment-form" className="card composer" onSubmit={submit}>
          {replyTo ? (
            <div id="reply-note" className="reply-note">
              <Glyph name="reply" size={16} />
              <span>Đang trả lời <b>{replyTo.to.author.name}</b><small className="muted">“{(mentionOf(replyTo.to) ? replyTo.to.content.slice(mentionOf(replyTo.to)!.length + 2) : replyTo.to.content).slice(0, 90)}{replyTo.to.content.length > 90 ? '…' : ''}”</small></span>
              <button type="button" className="icon-button" aria-label="Bỏ trả lời" onClick={() => setReplyTo(null)}>✕</button>
            </div>
          ) : null}
          <label className="sr-only" htmlFor="comment-content">Bình luận</label>
          <textarea id="comment-content" name="content" rows={3} placeholder={replyTo ? `Trả lời ${replyTo.to.author.name}…` : 'Viết bình luận… (trao đổi, hỏi thêm, báo vướng mắc)'} maxLength={4000} value={content}
            onChange={(e) => setContent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(); }} />
          {files.length ? (
            <div className="file-list pending-files">
              {files.map((f, i) => <span key={`${f.name}-${i}`} className="file-chip"><Glyph name="paperclip" size={13} />{f.name} · {kb(f.size)}<button type="button" aria-label={`Bỏ tệp ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button></span>)}
            </div>
          ) : null}
          <div className="composer-bar">
            <input ref={fileInput} type="file" multiple hidden accept={COMMENT_EXT.join(',')} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="button small secondary" onClick={() => fileInput.current?.click()}><Glyph name="paperclip" size={15} />Đính kèm tệp</button>
            <span className="muted small composer-hint">Tối đa 10 tệp, mỗi tệp 20 MB · Ctrl + Enter để gửi</span>
            <button className="button" type="submit" disabled={busy}>{busy ? 'Đang gửi…' : replyTo ? 'Gửi trả lời' : 'Gửi'}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function HistoryTab({ d }: { d: TaskDetailDto }) {
  const id = d.summary.id;
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ['history', id], queryFn: () => get<HistoryDto[]>(`/api/cong-viec/${id}/lich-su`), staleTime: 10_000 });
  if (!q.data && q.error) return <Failed error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading title="Đang tải lịch sử…" />;
  const g = params.get('group') || '';
  const rows = q.data.filter((h) => !g || (HISTORY_GROUP[g] || []).includes(h.type));
  const days = new Map<string, HistoryDto[]>();
  rows.forEach((h) => days.set(fmtDay(h.at), [...(days.get(fmtDay(h.at)) ?? []), h]));
  const filters: [string, string][] = [['', 'Tất cả'], ['progress', 'Tiến độ'], ['assign', 'Phân công'], ['due', 'Hạn & gia hạn'], ['result', 'Kết quả'], ['status', 'Trạng thái & nội dung']];
  const describe = (h: HistoryDto): React.ReactNode => {
    if (h.type === 'DoiTrangThai') return <>đổi trạng thái <b>{STATUS[Number(h.oldValue)]?.[0] ?? h.oldValue} → {STATUS[Number(h.newValue)]?.[0] ?? h.newValue}</b></>;
    if (h.type === 'CapNhatCongViec') {
      return <>sửa {FIELD_LABEL[h.field ?? ''] ?? h.field ?? 'công việc'}{h.field === 'HanHoanThanh' ? <>: <b>{fmtDay(h.oldValue)} → {fmtDay(h.newValue)}</b></> : h.field === 'PhanTramTienDo' ? <>: <b>{pct(h.oldValue)}% → {pct(h.newValue)}%</b></> : null}</>;
    }
    return h.description || HISTORY[h.type] || h.type;
  };
  const groupOf = (type: string) => Object.entries(HISTORY_GROUP).find(([, v]) => v.includes(type))?.[0] ?? 'status';
  return (
    <>
      <div className="chips">{filters.map(([k, l]) => <Link key={k} className={`chip ${g === k ? 'on' : ''}`} to={hashOf('/cong-viec/chi-tiet', { id, tab: 'history', group: k })}>{l}</Link>)}</div>
      <div className="card card-pad timeline">
        {days.size ? [...days.entries()].map(([day, list]) => (
          <div key={day} className="tl-day"><h4>{day}</h4>{list.map((h) => <div key={h.id} className="tl-row"><span className="muted small">{fmtTime(h.at)}</span><i className={`dot dot-${groupOf(h.type)}`} /><div>{h.by ? <b>{h.by.name} </b> : null}{describe(h)}</div></div>)}</div>
        )) : <p className="muted">Không có sự kiện.</p>}
      </div>
      <p className="muted small">Lịch sử ghi tự động, không ai sửa hoặc xóa được.</p>
    </>
  );
}

interface MAction { key: string; label: string; run: () => void; tone?: 'primary' | 'secondary' | 'green' | 'danger'; }

/** Bảng chọn thao tác trượt từ dưới lên (điện thoại): các thao tác phụ của công việc. */
function ActionSheet({ items, onClose }: { items: MAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const close = (then?: () => void) => closeDialog(ref.current, () => { onClose(); then?.(); });
  return (
    <dialog ref={ref} className="action-sheet" aria-labelledby="sheet-title" onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <h2 id="sheet-title" className="sheet-title">Thao tác khác</h2>
      <div className="sheet-list">
        {items.map((a) => <button key={a.key} type="button" className={`sheet-item ${a.tone === 'danger' ? 'danger' : ''}`} onClick={() => close(a.run)}>{a.label}</button>)}
      </div>
      <button type="button" className="button secondary sheet-cancel" onClick={() => close()}>Đóng</button>
    </dialog>
  );
}

/**
 * Thanh thao tác ghim ở đáy màn hình điện thoại (vùng ngón cái): tối đa hai thao tác quan trọng nhất
 * với người đang xem, các thao tác còn lại nằm trong nút "⋯". Dùng đúng các hộp thoại như bản máy tính.
 */
function MobileActionBar({ d }: { d: TaskDetailDto }) {
  const actions = useTaskActions();
  const navigate = useNavigate();
  const desk = useDesktopFirst();
  const [sheet, setSheet] = useState(false);
  const t = d.summary, p = d.permissions, id = t.id;
  const find = (k: keyof AssignmentDto['actions']) => d.assignments.find((a) => a.actions[k]);
  const list: MAction[] = [];
  const ev = find('canEvaluate'), ext = find('canDecideExtension'), dec = find('canDecideDecline');
  const acc = find('canAccept'), prog = find('canUpdateProgress'), sub = find('canSubmit');
  if (ev) list.push({ key: 'evaluate', label: 'Đánh giá kết quả', run: () => actions.open({ kind: 'evaluate', taskId: id, assignmentId: ev.id, resultId: ev.results[0]?.id }) });
  if (ext) list.push({ key: 'decide', label: 'Duyệt gia hạn', run: () => actions.open({ kind: 'decide', taskId: id, assignmentId: ext.id, extensionId: ext.extensions.find((e) => e.status === 0)?.id }) });
  if (dec) list.push({ key: 'decline', label: 'Duyệt xin từ chối', run: () => actions.open({ kind: 'decline-decide', taskId: id, assignmentId: dec.id, declineId: dec.declines.find((e) => e.status === 0)?.id }) });
  if (acc) list.push({ key: 'accept', label: 'Tiếp nhận', run: () => void actions.accept(id, acc.id) });
  if (prog) list.push({ key: 'progress', label: 'Cập nhật tiến độ', run: () => actions.open({ kind: 'progress', taskId: id, assignmentId: prog.id }) });
  if (sub) list.push({ key: 'submit', label: 'Nộp kết quả', run: () => actions.open({ kind: 'submit', taskId: id, assignmentId: sub.id }), tone: 'secondary' });
  if (p.canPublish) list.push({ key: 'publish', label: 'Tạo chính thức', run: () => void actions.changeStatus(id, 'publish') });
  if (p.canComplete) list.push({ key: 'complete', label: 'Đóng: Hoàn thành', run: () => void actions.changeStatus(id, 'complete'), tone: 'green' });
  const main = list.slice(0, 2);
  // Giao việc, sửa công việc: biểu mẫu dài, nhắc dùng máy tính (vẫn cho tiếp tục).
  const more: MAction[] = [
    ...list.slice(2),
    ...(p.canAssign ? [{ key: 'assign', label: 'Giao việc', run: () => desk.guard('Giao việc', () => actions.open({ kind: 'assign', taskId: id })) }] : []),
    ...(p.canEdit ? [{ key: 'edit', label: 'Sửa công việc', run: () => desk.guard('Sửa công việc', () => navigate(`/cong-viec/sua?id=${id}`)) }] : []),
    ...(p.canPause ? [{ key: 'pause', label: 'Tạm dừng', run: () => void actions.changeStatus(id, 'pause') }] : []),
    ...(p.canResume ? [{ key: 'resume', label: 'Tiếp tục', run: () => void actions.changeStatus(id, 'resume') }] : []),
    ...(p.canCancel ? [{ key: 'cancel', label: 'Hủy việc', run: () => void actions.changeStatus(id, 'cancel'), tone: 'danger' as const }] : []),
  ];
  if (!main.length && !more.length) return null;
  // Nút thứ hai luôn là nút phụ để nút chính nổi bật.
  const cls = (a: MAction, i: number) => `button ${i > 0 || a.tone === 'secondary' ? 'secondary' : a.tone === 'green' ? 'green' : ''}`;
  return (
    <>
      <div className="m-actionbar" role="toolbar" aria-label="Thao tác với công việc">
        {main.map((a, i) => <button key={a.key} type="button" className={cls(a, i)} onClick={a.run}>{a.label}</button>)}
        {more.length ? <button type="button" className="button secondary m-more" aria-label="Thao tác khác" aria-haspopup="dialog" onClick={() => setSheet(true)}><Glyph name="more" size={20} />{main.length ? null : <span>Thao tác</span>}</button> : null}
      </div>
      {sheet ? <ActionSheet items={more} onClose={() => setSheet(false)} /> : null}
      {desk.node}
    </>
  );
}

export function TaskDetailPage() {
  const [params] = useSearchParams();
  const id = Number(params.get('id'));
  const q = useTaskDetail(id);
  const actions = useTaskActions();
  const mobile = useIsMobile();
  useTitle(q.data?.summary.title ?? 'Chi tiết công việc');
  if (!id) return <Failed page error={{ status: 404, message: 'Thiếu mã công việc.' }} />;
  if (!q.data && q.error) return <Failed page error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading title="Đang tải công việc…" />;
  const d = q.data, t = d.summary, p = d.permissions;
  const tab = params.get('tab') || (t.assignedToMe ? 'assign' : 'overview');
  const nAssign = d.assignments.filter((a) => a.status < 5).length;
  const tabs: [string, string][] = mobile
    ? [['overview', 'Tổng quan'], ['assign', 'Phân công'], ['result', 'Kết quả'], ['discuss', 'Thảo luận'], ['history', 'Lịch sử']]
    : [['overview', 'Tổng quan'], ['assign', `Phân công (${nAssign})`], ['result', 'Kết quả & đánh giá'], ['discuss', 'Thảo luận'], ['history', 'Lịch sử']];
  const pendingExt = d.assignments.filter((a) => a.extensions.some((x) => x.status === 0) && a.actions.canDecideExtension).length;
  const due = dueInfo(t.due, [1, 2].includes(t.status));
  const deps = d.dependsOn.length ? `${d.dependsOn.filter((x) => x.status === 4).length}/${d.dependsOn.length} đã xong` : '';
  return (
    <>
      <div className="detail-head">
        <Link className="back-link" to="/cong-viec">‹ Công việc</Link>
        <div className="detail-title">
          <div className="stack-sm">
            <div className="tags"><Badge map={STATUS} value={t.status} /><Prio value={t.priority} /><span className="muted">· {t.categoryName || 'Chưa có thể loại'}</span></div>
            <h1 tabIndex={-1} id="page-title">{t.title}</h1>
            <p className="muted">{t.unitName} · tạo bởi {t.creatorName} ngày {fmtDay(t.createdAt)}</p>
          </div>
          {mobile ? null : <div className="actions wrap">
            {p.canPublish ? <button className="button" onClick={() => void actions.changeStatus(t.id, 'publish')}>Tạo chính thức</button> : null}
            {p.canEdit ? <ButtonLink to={`/cong-viec/sua?id=${t.id}`} kind="secondary">Sửa</ButtonLink> : null}
            {p.canPause ? <button className="button secondary" onClick={() => void actions.changeStatus(t.id, 'pause')}>Tạm dừng</button> : null}
            {p.canResume ? <button className="button secondary" onClick={() => void actions.changeStatus(t.id, 'resume')}>Tiếp tục</button> : null}
            {p.canComplete ? <button className="button green" onClick={() => void actions.changeStatus(t.id, 'complete')}>Đóng: Hoàn thành</button> : null}
            {p.canCancel ? <button className="button secondary danger-text" onClick={() => void actions.changeStatus(t.id, 'cancel')}>Hủy việc</button> : null}
            {p.canAssign ? <button className="button" onClick={() => actions.open({ kind: 'assign', taskId: t.id })}>+ Giao việc</button> : null}
          </div>}
        </div>
      </div>
      {p.readOnly ? <div className="notice" role="note">Bạn đang xem ở chế độ chỉ đọc. Quản trị hệ thống không giao hoặc duyệt nghiệp vụ nếu không giữ chức vụ tương ứng.</div> : null}
      {t.status === 0 ? <div className="notice" role="note">Đây là bản nháp, chỉ bạn nhìn thấy. Kiểm tra thông tin rồi bấm “Tạo chính thức” để giao việc.</div> : null}
      <div className="kv-grid">
        <dl className="kv"><dt>Tiến độ tổng</dt><dd>{pct(t.progress)}%</dd><Bar value={t.progress} tone={t.status === 4 ? 'green' : t.overdue ? 'orange' : ''} /></dl>
        <dl className="kv"><dt>Hạn hoàn thành</dt><dd>{fmtDay(t.due)}</dd>
          {pendingExt ? <Link className="kv-link warn" to={hashOf('/cong-viec/chi-tiet', { id: t.id, tab: 'assign' })}>{pendingExt} yêu cầu gia hạn chờ duyệt ›</Link>
            : <span className={`due ${due.cls} small`}>{due.cls ? due.text.split(' · ')[1] : t.status === 4 ? 'Đã hoàn thành ' + fmtDay(t.completedAt) : ''}</span>}
        </dl>
        <dl className="kv kv-assign"><dt>Phân công</dt><dd>{d.assignments.filter((a) => a.status < 5).length} người / đơn vị</dd><span className="muted small">{d.assignments.filter((a) => a.status === 3).length} chờ duyệt · {d.assignments.filter((a) => a.status === 4).length} hoàn thành</span></dl>
        <dl className={`kv ${d.dependsOn.length ? '' : 'kv-none'}`}><dt>Phụ thuộc</dt><dd>{d.dependsOn.length ? d.dependsOn.length + ' việc trước' : 'Không có'}</dd><span className="muted small">{deps}</span></dl>
      </div>
      <nav className="tabs" aria-label="Nội dung công việc">
        {tabs.map(([k, l]) => <Link key={k} to={hashOf('/cong-viec/chi-tiet', { id: t.id, tab: k })} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}>{l}</Link>)}
      </nav>
      <div className="tab-body tab-anim" key={tab}>
        {tab === 'assign' ? <AssignTab d={d} /> : tab === 'result' ? <ResultTab d={d} /> : tab === 'discuss' ? <DiscussTab d={d} /> : tab === 'history' ? <HistoryTab d={d} /> : <OverviewTab d={d} />}
      </div>
      {mobile ? <MobileActionBar d={d} /> : null}
    </>
  );
}
