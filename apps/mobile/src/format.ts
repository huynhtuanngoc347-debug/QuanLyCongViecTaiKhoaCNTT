/** Định dạng ngày giờ theo giờ Việt Nam (máy chủ trả ISO UTC). */
const TZ = 'Asia/Ho_Chi_Minh';
export const DAY = 86400000;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const partsFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' });

export const isoDay = (v: string | Date): string => dayFmt.format(new Date(v));
export const todayIso = (): string => dayFmt.format(new Date());
export const addDays = (iso: string, n: number): string => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const time = (v: string | Date): string => timeFmt.format(new Date(v));
const dm = (v: string | Date) => { const p = Object.fromEntries(partsFmt.formatToParts(new Date(v)).map((x) => [x.type, x.value])); return { d: Number(p.day), m: Number(p.month), y: Number(p.year) }; };
export const fullDate = (v: string | Date): string => { const { d, m, y } = dm(v); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`; };

/** "Hôm nay, 17:00" · "Hôm qua, 23:59" · "Ngày mai, 08:00" · "26 Th6, 09:00" (giống bản thiết kế). */
export function friendly(v: string | null | undefined, withTime = true): string {
  if (!v) return 'Chưa đặt hạn';
  const day = isoDay(v), today = todayIso();
  const t = withTime ? `, ${time(v)}` : '';
  if (day === today) return `Hôm nay${t}`;
  if (day === addDays(today, -1)) return `Hôm qua${t}`;
  if (day === addDays(today, 1)) return `Ngày mai${t}`;
  const { d, m, y } = dm(v);
  return `${d} Th${m}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}${t}`;
}

/** "còn 2 ngày" / "trễ 3 ngày" / "còn 5 giờ". */
export function remaining(v: string | null | undefined): { text: string; late: boolean; soon: boolean } {
  if (!v) return { text: '', late: false, soon: false };
  const ms = new Date(v).getTime() - Date.now();
  if (ms < 0) return { text: `trễ ${Math.max(1, Math.ceil(-ms / DAY))} ngày`, late: true, soon: false };
  if (ms < DAY) return { text: `còn ${Math.max(1, Math.round(ms / 3600000))} giờ`, late: false, soon: true };
  return { text: `còn ${Math.ceil(ms / DAY)} ngày`, late: false, soon: ms <= 3 * DAY };
}

export function relative(v: string): string {
  const diff = Date.now() - new Date(v).getTime();
  if (diff < 60000) return 'Vừa xong';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
  if (isoDay(v) === todayIso()) return `${Math.floor(diff / 3600000)} giờ trước`;
  return friendly(v);
}

export const kb = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const normalize = (value: unknown): string =>
  String(value ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
export const pct = (v: unknown): number => Math.round(Number(v) || 0);
