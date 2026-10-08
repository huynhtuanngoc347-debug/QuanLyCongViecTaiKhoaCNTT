/** Tiện ích chuỗi, giống Text.Normalize / Mapping của bản C#. */

/** Bỏ dấu tiếng Việt, đ→d, chữ thường (giống normalize() phía giao diện). */
export function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Gộp khoảng trắng thừa. */
export function collapseSpaces(value: unknown): string {
  return String(value ?? '')
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' ');
}

/** Cắt khoảng trắng hai đầu; null/undefined → "". */
export const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

export function nullIfEmpty(value: unknown): string | null {
  const s = collapseSpaces(value);
  return s.length === 0 ? null : s;
}

/** Cắt chuỗi dài, thêm "…" (Notifier.Cut). Đếm theo ký tự UTF-16 như C#. */
export function cut(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}

/** Hai chữ cái đầu của hai từ cuối họ tên: "Nguyễn Văn Lễ" → "VL". */
export function initials(fullName: string): string {
  const words = String(fullName ?? '')
    .split(' ')
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return '?';
  const chosen = words.length === 1 ? words : words.slice(-2);
  return chosen.map((w) => w[0].toLocaleUpperCase('vi-VN')).join('');
}

/** "Bộ môn Khoa học dữ liệu" → "KD": bỏ chữ loại đơn vị ở đầu. */
export function unitInitials(name: string | null | undefined): string {
  const words = String(name ?? '').split(' ').filter(Boolean);
  const head = words.length > 2 ? normalize(words[0] + ' ' + words[1]) : '';
  const skip = words.length > 2 && ['bo mon', 'hoi dong', 'van phong'].includes(head) ? 2 : 0;
  const rest = words.slice(skip);
  if (rest.length === 0) return 'ĐV';
  const picked = [rest[0], ...rest.slice(Math.max(1, rest.length - 1))];
  return picked.map((w) => w[0].toUpperCase()).join('');
}

/** Ép kiểu dữ liệu JSON nhận từ giao diện (cho phép số dạng chuỗi như bản C#). */
export function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function toBool(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function toStr(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function toIntList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(toInt).filter((v): v is number => v !== null);
}

/** Số "0.##" như C# decimal.ToString("0.##"). */
export function formatDecimal(value: number): string {
  return String(Math.round(value * 100) / 100);
}
