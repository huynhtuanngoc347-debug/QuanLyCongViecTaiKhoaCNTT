import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Building2, ChevronRight, Info, LockKeyhole, LogOut, Monitor, Moon } from 'lucide-react';
import type { PersonalStatsDto } from '@khoa/shared';
import { get, send } from '../api';
import { useSession } from '../session';
import { FieldError, PageHeader, Sheet, button, field, useUi } from '../ui';
import { todayIso } from '../format';

/** Học kỳ hiện tại: HK I 01/08 – 31/01, HK II 01/02 – 31/07. */
function semester(): { from: string; to: string; label: string } {
  const [y, m] = todayIso().split('-').map(Number);
  if (m >= 8) return { from: `${y}-08-01`, to: `${y + 1}-01-31`, label: `HK I ${y}–${y + 1}` };
  if (m === 1) return { from: `${y - 1}-08-01`, to: `${y}-01-31`, label: `HK I ${y - 1}–${y}` };
  return { from: `${y}-02-01`, to: `${y}-07-31`, label: `HK II ${y - 1}–${y}` };
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { notify } = useUi();
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Đổi mật khẩu" onClose={onClose}>
      <form noValidate onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const currentPassword = String(fd.get('current') || ''), newPassword = String(fd.get('next') || ''), again = String(fd.get('again') || '');
        if (newPassword !== again) { setErrors({ again: 'Mật khẩu nhập lại không khớp.' }); return; }
        setBusy(true);
        try {
          const r = await send('POST', '/api/auth/doi-mat-khau', { currentPassword, newPassword });
          if (r.errors) { setErrors(r.errors); return; }
          notify('Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.'); onClose();
        } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
      }}>
        <label className="mb-4 block text-xs font-bold">Mật khẩu hiện tại<input name="current" type="password" autoComplete="current-password" className={`${field} mt-2`} /><FieldError text={errors?.currentPassword} /></label>
        <label className="mb-4 block text-xs font-bold">Mật khẩu mới<input name="next" type="password" autoComplete="new-password" className={`${field} mt-2`} /><FieldError text={errors?.newPassword} /></label>
        <label className="mb-5 block text-xs font-bold">Nhập lại mật khẩu mới<input name="again" type="password" autoComplete="new-password" className={`${field} mt-2`} /><FieldError text={errors?.again} /></label>
        <button className={`${button} w-full`} disabled={busy}>{busy ? 'Đang lưu…' : 'Cập nhật mật khẩu'}</button>
      </form>
    </Sheet>
  );
}

export function ProfilePage() {
  const { session, logout, isMember } = useSession();
  const { dark, setDark, notify } = useUi();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<'' | 'password' | 'about'>('');
  const sem = semester();
  const stats = useQuery({ queryKey: ['stats', 'me', sem.from], queryFn: () => get<PersonalStatsDto>(`/api/thong-ke/ca-nhan?from=${sem.from}&to=${sem.to}`), enabled: isMember, staleTime: 60_000 });
  const u = session!.user;
  const s = stats.data;
  const units = s?.memberships.filter((m) => !m.ended) ?? [];
  const Row = ({ icon: Icon, label, value, onClick, toggle, danger }: { icon: typeof Info; label: string; value?: string; onClick: () => void; toggle?: boolean; danger?: boolean }) => (
    <button className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 text-left last:border-0 active:bg-slate-50" onClick={onClick}>
      <Icon size={18} className={danger ? 'text-red-500' : 'text-slate-400'} />
      <span className={`flex-1 text-[13px] font-semibold ${danger ? 'text-red-500' : ''}`}>{label}</span>
      {toggle !== undefined ? (
        <span role="switch" aria-checked={toggle} className={`flex h-6 w-10 items-center rounded-full p-1 transition ${toggle ? 'justify-end bg-primary' : 'bg-slate-200'}`}><span className="size-4 rounded-full bg-white" /></span>
      ) : danger ? null : <><span className="text-[11px] text-slate-400">{value}</span><ChevronRight size={15} className="text-slate-300" /></>}
    </button>
  );
  return (
    <>
      <PageHeader title="Hồ sơ cá nhân" />
      <div className="mb-7 rounded-[24px] bg-gradient-to-br from-blue-50 to-[#e9edfb] p-6 text-center">
        <div className="mx-auto mb-3 flex size-20 items-center justify-center rounded-full border-4 border-white bg-[#d3defa] text-2xl font-bold text-[#5269a8]">{u.initials}</div>
        <h2 className="text-lg font-extrabold">{u.name}</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-slate-500">{u.roleSummary || u.email}</p>
        <span className="mt-4 inline-flex rounded-full bg-white px-3 py-2 text-[11px] font-semibold text-primary">{units[0]?.unitName ?? 'Khoa Công nghệ Thông tin'}</span>
        {isMember ? (
          <div className="mt-5 grid grid-cols-3 border-t border-blue-100 pt-4">
            {[
              [s ? String(s.completed) : '–', 'Hoàn thành'],
              [s ? (s.completed ? `${s.onTimePercent}%` : '—') : '–', 'Đúng hạn'],
              [s ? String(s.overdue) : '–', 'Quá hạn'],
            ].map(([value, label]) => (
              <div key={label}><p className={`text-xl font-bold ${label === 'Quá hạn' && s?.overdue ? 'text-red-500' : ''}`}>{value}</p><p className="mt-1 text-[10.5px] text-slate-500">{label}</p></div>
            ))}
          </div>
        ) : null}
        {isMember ? <p className="mt-3 text-[10.5px] text-slate-400">Số liệu {sem.label}{s?.unitAverageOnTime != null ? ` · trung bình đơn vị ${s.unitAverageOnTime}% đúng hạn` : ''}</p> : null}
      </div>

      {units.length ? (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-bold text-slate-400">ĐƠN VỊ THAM GIA</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-white">
            {units.map((m) => (
              <button key={`${m.unitId}-${m.role}`} onClick={() => navigate(`/tasks?scope=assigned`)} className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0">
                <Building2 size={18} className="text-slate-400" />
                <span className="flex-1"><span className="block text-[13px] font-semibold">{m.unitName}</span><span className="text-[11px] text-slate-500">{m.role}{m.primary ? ' · Đơn vị chính' : ''}</span></span>
                <span className="text-[11px] font-semibold text-slate-500">{m.openTasks} việc</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-3 text-xs font-bold text-slate-400">TÀI KHOẢN</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-white">
          <Row icon={LockKeyhole} label="Đổi mật khẩu" onClick={() => setPanel('password')} />
          <Row icon={Moon} label="Chế độ tối" toggle={dark} onClick={() => setDark(!dark)} />
        </div>
      </section>
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-bold text-slate-400">KHÁC</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-white">
          {isMember ? <Row icon={BarChart3} label="Thống kê chi tiết" value="Bản máy tính" onClick={() => { window.location.href = '/#/thong-ke-ca-nhan'; }} /> : null}
          <Row icon={Monitor} label="Mở bản máy tính" onClick={() => { window.location.href = '/'; }} />
          <Row icon={Info} label="Về ứng dụng" onClick={() => setPanel('about')} />
          <Row icon={LogOut} label="Đăng xuất" danger onClick={async () => { try { await logout(); navigate('/login', { replace: true }); notify('Đã đăng xuất.'); } catch (e) { notify((e as Error).message, true); } }} />
        </div>
      </section>
      <p className="text-center text-[11px] leading-5 text-slate-400">Quản lý công việc · Khoa Công nghệ Thông tin<br />Bản di động</p>
      {panel === 'password' ? <PasswordSheet onClose={() => setPanel('')} /> : null}
      {panel === 'about' ? (
        <Sheet title="Về ứng dụng" onClose={() => setPanel('')}>
          <p className="text-[13px] leading-7 text-slate-500">Bản di động của hệ thống Quản lý công việc Khoa Công nghệ Thông tin: xem việc được giao, cập nhật tiến độ, nộp và duyệt kết quả, trao đổi và nhận thông báo. Các chức năng quản trị (cơ cấu tổ chức, chức vụ, mẫu công việc, nhật ký) dùng trên bản máy tính.</p>
        </Sheet>
      ) : null}
    </>
  );
}
