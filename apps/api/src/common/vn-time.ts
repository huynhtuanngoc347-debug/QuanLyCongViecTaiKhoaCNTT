/**
 * Giờ Việt Nam (UTC+7, không đổi giờ mùa hè). CSDL lưu UTC; người dùng nhập ngày "yyyy-MM-dd" theo giờ Việt Nam.
 * Thư viện mssql đọc DATETIME2 thành Date theo UTC (useUTC: true).
 */
export const OFFSET_MS = 7 * 3600 * 1000;
export const DAY_MS = 86400000;

export const nowUtc = (): Date => new Date();

function isValidYmd(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** "yyyy-MM-dd" → thời điểm UTC của đầu ngày (00:00) hoặc cuối ngày (23:59:59) giờ Việt Nam. null nếu sai. */
export function parseVnDate(text: unknown, endOfDay: boolean): Date | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!isValidYmd(t)) return null;
  const startUtcOfLocalDay = Date.parse(t + 'T00:00:00Z') - OFFSET_MS;
  return new Date(endOfDay ? startUtcOfLocalDay + DAY_MS - 1000 : startUtcOfLocalDay);
}

/** Ngày thuần (cột DATE hoặc DateOnly) "yyyy-MM-dd" → Date 00:00 UTC. */
export function parseYmd(text: unknown): Date | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  return isValidYmd(t) ? new Date(t + 'T00:00:00Z') : null;
}

/** Ngày giờ Việt Nam (dạng Date "giả" có các trường UTC = giờ địa phương) để lấy năm/tháng/ngày. */
export const toLocal = (utc: Date): Date => new Date(utc.getTime() + OFFSET_MS);

/** Ngày (giờ Việt Nam) của một thời điểm UTC: yyyy-MM-dd. */
export const localDate = (utc: Date): string => toLocal(utc).toISOString().slice(0, 10);

/** dd/MM/yyyy theo giờ Việt Nam. */
export function localText(utc: Date): string {
  const [y, m, d] = localDate(utc).split('-');
  return `${d}/${m}/${y}`;
}

/** Hôm nay theo giờ Việt Nam, dạng Date 00:00 UTC (dùng như ngày thuần). */
export function todayLocal(): Date {
  return new Date(localDate(new Date()) + 'T00:00:00Z');
}

/** Ngày thuần (Date 00:00 UTC) → yyyy-MM-dd. */
export const formatDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Cộng tháng cho ngày thuần (giống DateTime.AddMonths: giữ ngày, kẹp cuối tháng). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
