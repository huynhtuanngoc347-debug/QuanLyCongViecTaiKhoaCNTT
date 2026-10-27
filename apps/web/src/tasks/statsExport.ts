import type { UnitStatsDto } from '@khoa/shared';
import { S, colName, type Cell, type Row, type Sheet, type Style } from './xlsx';

/** "2026-08-01" → "01/08/2026". */
const day = (iso: string) => iso.split('-').reverse().join('/');
/** Tỷ lệ 0–100 của API → giá trị Excel 0–1 (ô định dạng %). */
const ratio = (percent: number) => percent / 100;
/** Đúng hạn chỉ có nghĩa khi đã hoàn thành ít nhất một việc; chưa có thì ghi "–" thay vì 0%. */
const onTime = (percent: number, completed: number): string | number => (completed > 0 ? ratio(percent) : '–');

/** Dòng tiêu đề bảng nằm ở dòng này (sau phần đầu trang 6 dòng + 1 dòng trống). */
const TABLE_HEAD_ROW = 8;

/** Phần đầu trang kiểu văn bản hành chính: Trường, Khoa, tên báo cáo, phạm vi, kỳ và thời điểm xuất. */
function header(title: string, s: UnitStatsDto, width: number, exportedAt: Date): { rows: Row[]; merges: string[] } {
  const last = colName(width - 1);
  const at = exportedAt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  return {
    rows: [
      [{ v: 'TRƯỜNG ĐẠI HỌC CÔNG THƯƠNG THÀNH PHỐ HỒ CHÍ MINH', s: S.org }],
      [{ v: 'KHOA CÔNG NGHỆ THÔNG TIN', s: S.orgBold }],
      [],
      [{ v: title, s: S.title }],
      [{ v: s.scopeLabel, s: S.subtitle }],
      [{ v: `Kỳ thống kê ${day(s.from)} – ${day(s.to)}, Xuất lúc ${at}`, s: S.subtitle }],
    ],
    merges: [`A4:${last}4`, `A5:${last}5`, `A6:${last}6`],
  };
}

/** Bảng có dòng tiêu đề cột và dòng xen kẽ màu; kind quyết định kiểu từng cột. */
function table(head: string[], kinds: ('text' | 'int' | 'pct')[], data: (string | number)[][]): Row[] {
  const style = (k: 'text' | 'int' | 'pct', alt: boolean): Style =>
    k === 'text' ? (alt ? S.textAlt : S.text) : k === 'int' ? (alt ? S.intAlt : S.int) : (alt ? S.pctAlt : S.pct);
  return [
    head.map((h): Cell => ({ v: h, s: S.head })),
    ...data.map((r, i) => r.map((v, c): Cell => ({ v, s: style(kinds[c], i % 2 === 1) }))),
  ];
}

const totalRow = (cells: (string | number)[], kinds: ('text' | 'int' | 'pct')[]): Row =>
  cells.map((v, c): Cell => ({ v, s: kinds[c] === 'text' ? S.totalText : kinds[c] === 'int' ? S.totalInt : S.totalPct }));

export function statsSheets(s: UnitStatsDto, exportedAt = new Date()): Sheet[] {
  // ---- Trang 1: Tổng quan ----
  const h1 = header('THỐNG KÊ CÔNG VIỆC – TỔNG QUAN', s, 3, exportedAt);
  const kpi: [string, string | number, Style][] = [
    ['Tổng số công việc', s.total, S.int], ['Đang mở', s.open, S.int], ['Đã hoàn thành', s.completed, S.int],
    ['Hoàn thành đúng hạn', s.onTimeCount, S.int], ['Tỷ lệ hoàn thành đúng hạn', onTime(s.onTimePercent, s.completed), S.pct],
    ['Đang quá hạn', s.overdue, S.int], ['Kết quả được duyệt Đạt', s.passed, S.int], ['Kết quả Cần bổ sung', s.needsWork, S.int], ['Kết quả Không đạt', s.failed, S.int],
  ];
  const overview: Row[] = [
    ...h1.rows,
    [{ v: 'Tệp gồm 3 trang tính: Tổng quan, Theo đơn vị, Theo nhân sự (số liệu từng giảng viên, kể cả người chưa được giao việc).', s: S.subtitle }],
    [{ v: 'Chỉ số chính', s: S.section }],
    [{ v: 'Chỉ số', s: S.head }, { v: 'Giá trị', s: S.head }],
    ...kpi.map(([label, v, st]): Row => [{ v: label, s: S.label }, { v, s: st }]),
    [],
    [{ v: 'Theo trạng thái', s: S.section }],
    ...table(['Trạng thái', 'Số công việc', 'Tỷ lệ'], ['text', 'int', 'pct'],
      s.byStatus.map((x) => [x.label, x.value, s.total ? x.value / s.total : 0])),
    totalRow(['Tổng cộng', s.byStatus.reduce((n, x) => n + x.value, 0), s.total ? 1 : 0], ['text', 'int', 'pct']),
    [],
    [{ v: 'Tạo mới và hoàn thành theo tháng', s: S.section }],
    ...table(['Tháng', 'Tạo mới', 'Hoàn thành'], ['text', 'int', 'int'],
      s.byMonth.map((m) => [`Tháng ${Number(m.month.slice(5))}/${m.month.slice(0, 4)}`, m.assigned, m.completed])),
  ];

  // ---- Trang 2: Theo đơn vị ----
  const h2 = header('THỐNG KÊ CÔNG VIỆC THEO ĐƠN VỊ', s, 6, exportedAt);
  const unitKinds: ('text' | 'int' | 'pct')[] = ['text', 'int', 'int', 'int', 'int', 'pct'];
  const units = [...s.byUnit].sort((a, b) => b.total - a.total || a.unitName.localeCompare(b.unitName, 'vi'));
  const unitRows: Row[] = [
    ...h2.rows, [],
    ...table(['Đơn vị', 'Tổng số việc', 'Đang mở', 'Đã hoàn thành', 'Đang quá hạn', 'Đúng hạn'], unitKinds,
      units.map((u) => [u.unitName, u.total, u.open, u.completed, u.overdue, onTime(u.onTimePercent, u.completed)])),
    totalRow(['Toàn phạm vi', s.total, s.open, s.completed, s.overdue, onTime(s.onTimePercent, s.completed)], unitKinds),
  ];
  const unitHead = TABLE_HEAD_ROW;

  // ---- Trang 3: Theo nhân sự ----
  const PERSON_HEAD = ['Họ và tên', 'Đơn vị', 'Được giao', 'Chủ trì', 'Phối hợp', 'Đang làm', 'Chờ duyệt', 'Đã hoàn thành',
    'Đúng hạn', 'Trễ hạn', 'Đang quá hạn', 'Đạt', 'Cần bổ sung', 'Không đạt'];
  const personKinds: ('text' | 'int' | 'pct')[] = ['text', 'text', 'int', 'int', 'int', 'int', 'int', 'int', 'pct', 'int', 'int', 'int', 'int', 'int'];
  const h3 = header('THỐNG KÊ CÔNG VIỆC THEO NHÂN SỰ', s, PERSON_HEAD.length, exportedAt);
  const people = [...s.byPerson].sort((a, b) => a.unitName.localeCompare(b.unitName, 'vi') || a.name.localeCompare(b.name, 'vi'));
  const sum = (k: keyof (typeof people)[number]) => people.reduce((n, x) => n + Number(x[k] ?? 0), 0);
  const doneAll = sum('completed'), lateAll = sum('late');
  const personRows: Row[] = [
    ...h3.rows, [],
    ...table(PERSON_HEAD, personKinds,
      people.map((x) => [x.name, x.unitName || '—', x.assigned, x.lead, x.support, x.inProgress, x.waitingReview, x.completed,
        onTime(x.onTimePercent, x.completed), x.late, x.overdue, x.passed, x.needsWork, x.failed])),
    totalRow([`Tổng cộng (${people.length} người)`, `${people.filter((x) => x.assigned === 0).length} người chưa được giao việc`, sum('assigned'), sum('lead'), sum('support'),
      sum('inProgress'), sum('waitingReview'), doneAll, doneAll ? (doneAll - lateAll) / doneAll : '–', lateAll, sum('overdue'), sum('passed'), sum('needsWork'), sum('failed')], personKinds),
    [],
    [{ v: 'Ghi chú: chỉ tính phân công cá nhân trong kỳ. Chủ trì / Phối hợp theo vai trò khi giao việc; Đúng hạn tính trên số việc đã hoàn thành.', s: S.subtitle }],
  ];

  return [
    { name: 'Tổng quan', cols: [40, 16, 14], rows: overview, merges: h1.merges },
    { name: 'Theo đơn vị', cols: [44, 14, 12, 15, 15, 12], rows: unitRows, merges: h2.merges, freezeRows: unitHead,
      autoFilter: units.length ? `A${unitHead}:F${unitHead + units.length}` : undefined },
    { name: 'Theo nhân sự', cols: [28, 45, 10, 9, 10, 10, 10, 13, 10, 9, 13, 8, 12, 10], rows: personRows, merges: h3.merges, freezeRows: unitHead,
      autoFilter: people.length ? `A${unitHead}:N${unitHead + people.length}` : undefined },
  ];
}
