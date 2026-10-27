/** Định dạng ngày giờ theo giờ Việt Nam và tiện ích chung (giống js/tasks.js, js/store.js). */
const TZ = 'Asia/Ho_Chi_Minh';
const dayFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const isoDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const DAY = 86400000;
export const toDate = (v: string | number | Date): Date => (v instanceof Date ? v : new Date(v));
const parts = (fmt: Intl.DateTimeFormat, v: string | Date) => Object.fromEntries(fmt.formatToParts(toDate(v)).map((p) => [p.type, p.value]));

export const fmtDay = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const p = parts(dayFmt, v);
  return `${p.day}/${p.month}/${p.year}`;
};
export const fmtShort = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const p = parts(shortFmt, v);
  return `${p.day}/${p.month}`;
};
export const fmtTime = (v: string | Date | null | undefined): string => (v ? timeFmt.format(toDate(v)) : '');
export const isoDay = (v: string | Date | null | undefined): string => (v ? isoDayFmt.format(toDate(v)) : '');
export const todayIso = (): string => isoDayFmt.format(new Date());
export const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** "yyyy-MM-dd" → "dd/MM/yyyy" */
export const ymdText = (iso: string | null | undefined): string => (iso ? iso.split('-').reverse().join('/') : 'Chưa xác định');

export function relative(v: string | Date): string {
  const diff = Date.now() - toDate(v).getTime();
  if (diff < 60000) return 'vừa xong';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
  if (diff < DAY && isoDay(v) === todayIso()) return `${Math.floor(diff / 3600000)} giờ trước`;
  if (isoDay(v) === addDaysIso(todayIso(), -1)) return `Hôm qua, ${fmtTime(v)}`;
  return `${fmtDay(v)} ${fmtTime(v)}`;
}

/** "05/10 · còn 2 ngày" / "28/09 · trễ 3 ngày" + lớp màu. */
export function dueInfo(due: string | null | undefined, open = true): { text: string; cls: string } {
  if (!due) return { text: 'Chưa đặt hạn', cls: '' };
  const d = toDate(due), ms = d.getTime() - Date.now();
  if (!open) return { text: fmtShort(d), cls: '' };
  if (ms < 0) return { text: `${fmtShort(d)}, trễ ${Math.max(1, Math.ceil(-ms / DAY))} ngày`, cls: 'late' };
  if (ms <= 3 * DAY) {
    const h = ms / 3600000;
    return { text: h < 24 ? `${fmtShort(d)}, còn ${Math.max(1, Math.round(h))} giờ` : `${fmtShort(d)}, còn ${Math.ceil(ms / DAY)} ngày`, cls: 'soon' };
  }
  return { text: fmtShort(d), cls: '' };
}

export const pct = (v: unknown): number => Math.round(Number(v) || 0);
export const kb = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Bỏ dấu tiếng Việt để tìm kiếm. */
export const normalize = (value: unknown): string =>
  String(value ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export const today = todayIso;

export function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}

/** Thành viên còn hiệu lực hôm nay (tính cả ngày kết thúc). */
export const currentMembership = (m: { start: string; end: string }, date = todayIso()) => m.start <= date && (!m.end || m.end >= date);
