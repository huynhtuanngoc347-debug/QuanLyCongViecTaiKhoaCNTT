import { todayIso } from '../format';

export type PeriodKey = 'month' | 'semester' | 'year' | 'custom';
export interface Period { preset: PeriodKey; from: string; to: string; presets: Record<'month' | 'semester' | 'year', [string, string, string]>; }

/** Kỳ thống kê: tháng này, học kỳ (HK I 01/08–31/01, HK II 01/02–31/07), năm học (01/08–31/07), hoặc tùy chọn. */
export function periodOf(params: URLSearchParams | { get: (k: string) => string | null }): Period {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  const semStart = m >= 8 ? `${y}-08-01` : m === 1 ? `${y - 1}-08-01` : `${y}-02-01`;
  const semEnd = m >= 8 || m === 1 ? `${m >= 8 ? y + 1 : y}-01-31` : `${y}-07-31`;
  const yearStart = m >= 8 ? `${y}-08-01` : `${y - 1}-08-01`;
  const yearEnd = m >= 8 ? `${y + 1}-07-31` : `${y}-07-31`;
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const presets: Period['presets'] = {
    month: [monthStart, monthEnd, 'Tháng này'],
    semester: [semStart, semEnd, `Học kỳ ${m >= 8 || m === 1 ? 'I' : 'II'} ${m >= 8 ? `${y}–${y + 1}` : `${y - 1}–${y}`}`],
    year: [yearStart, yearEnd, `Năm học ${m >= 8 ? `${y}–${y + 1}` : `${y - 1}–${y}`}`],
  };
  const preset = (params.get('period') || 'semester') as PeriodKey;
  if (preset === 'custom') return { preset, from: params.get('from') || semStart, to: params.get('to') || semEnd, presets };
  const chosen = presets[preset as keyof Period['presets']] ?? presets.semester;
  return { preset: presets[preset as keyof Period['presets']] ? preset : 'semester', from: chosen[0], to: chosen[1], presets };
}
