import type { TaskScope } from '@khoa/shared';
import { toInt } from './text';

const TASK_SCOPES: readonly TaskScope[] = ['assigned', 'created', 'all', 'review'];

/** Phạm vi danh sách công việc hợp lệ (phân biệt hoa thường, đúng như giao diện gửi). */
export const isTaskScope = (value: string): value is TaskScope => (TASK_SCOPES as readonly string[]).includes(value);

/** Số dòng tối đa: không phải số nguyên dương → dùng mặc định; vượt trần → kẹp về trần. */
export function clampLimit(text: string | undefined, fallback: number, max: number): number {
  const n = toInt(text);
  return n != null && n > 0 ? Math.min(max, n) : fallback;
}
