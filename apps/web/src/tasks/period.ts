import { todayIso } from '../format';

export type PeriodKey = 'month' | 'year' | 'custom';
export interface Period { preset: PeriodKey; from: string; to: string; presets: Record<'month' | 'year', [string, string, string]>; }

/**
 * Kỳ thống kê: tháng này, năm học (01/08–31/07, mặc định), hoặc tùy chọn.
 * Đã bỏ "Học kỳ" (đường dẫn cũ ?period=semester tự chuyển sang năm học).
 */
export function periodOf(params: URLSearchParams | { get: (k: string) => string | null }): Period {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  const yearStart = m >= 8 ? `${y}-08-01` : `${y - 1}-08-01`;
  const yearEnd = m >= 8 ? `${y + 1}-07-31` : `${y}-07-31`;
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const presets: Period['presets'] = {
    month: [monthStart, monthEnd, 'Tháng này'],
    year: [yearStart, yearEnd, `Năm học ${m >= 8 ? `${y}–${y + 1}` : `${y - 1}–${y}`}`],
  };
  const preset = (params.get('period') || 'year') as PeriodKey;
  if (preset === 'custom') return { preset, from: params.get('from') || yearStart, to: params.get('to') || yearEnd, presets };
  const chosen = presets[preset as keyof Period['presets']] ?? presets.year;
  return { preset: presets[preset as keyof Period['presets']] ? preset : 'year', from: chosen[0], to: chosen[1], presets };
}
