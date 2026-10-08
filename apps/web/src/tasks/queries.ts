import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryDto, NotificationListDto, TaskDetailDto, TaskListDto, TemplateDto } from '@khoa/shared';
import { get } from '../api/client';
import { useSession } from '../session';

/** Truy vấn dữ liệu phân hệ Công việc (TanStack Query, khóa giống bộ nhớ đệm của bản cũ). */
export const useTaskList = (scope: string, enabled = true) =>
  useQuery({ queryKey: ['list', scope], queryFn: () => get<TaskListDto>(`/api/cong-viec?scope=${encodeURIComponent(scope)}`), enabled, staleTime: 60_000 });

export const useTaskDetail = (id: number, enabled = true) =>
  useQuery({ queryKey: ['detail', id], queryFn: () => get<TaskDetailDto>(`/api/cong-viec/${id}`), enabled: enabled && id > 0, staleTime: 15_000, retry: false });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => get<CategoryDto[]>('/api/the-loai'), staleTime: 300_000 });

export const useTemplates = (enabled = true) =>
  useQuery({ queryKey: ['templates'], queryFn: () => get<TemplateDto[]>('/api/mau-cong-viec'), staleTime: 5_000, enabled });

export function useNotifications() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['notif'],
    queryFn: () => get<NotificationListDto>('/api/thong-bao?limit=30'),
    enabled: !!session,
    staleTime: 30_000,
    refetchInterval: () => (document.hidden ? false : 60_000),
  });
}

/** Sau mỗi thao tác: làm mới danh sách, thông báo, thống kê, bình luận/lịch sử và chi tiết công việc. */
export function useAfterChange() {
  const qc = useQueryClient();
  return (taskId?: number | null) => {
    void qc.invalidateQueries({ queryKey: ['list'] });
    void qc.invalidateQueries({ queryKey: ['notif'] });
    void qc.invalidateQueries({ queryKey: ['notif-all'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
    if (taskId) {
      void qc.invalidateQueries({ queryKey: ['detail', taskId] });
      void qc.invalidateQueries({ queryKey: ['comments', taskId] });
      void qc.invalidateQueries({ queryKey: ['history', taskId] });
    }
  };
}

/** Tạo chuỗi hash có tham số, bỏ giá trị rỗng (giống hash() của bản cũ). */
export function hashOf(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)
      .map(([k, v]) => [k, v === true ? '1' : String(v)]),
  ).toString();
  return `${path}${q ? '?' + q : ''}`;
}
