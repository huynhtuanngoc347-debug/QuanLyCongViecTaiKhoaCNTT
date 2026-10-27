import type { GlyphName } from './ui/glyph';
import { useSession } from './session';

/** Quyền vào trang + menu theo quyền (giao diện chỉ ẩn/hiện; máy chủ kiểm tra lại mọi thao tác). */
export const PORTAL_ICONS: Record<string, GlyphName> = { admin: 'shield', 'ca-nhan': 'user' };

/** Chức năng quản trị chỉ dùng trên máy tính; điện thoại ẩn khỏi menu và hiện lời nhắc nếu mở bằng đường dẫn. */
export const DESKTOP_ONLY = new Set(['/admin', '/chuc-vu', '/the-loai', '/mau-cong-viec', '/nhat-ky', '/sao-luu', '/them-nhan-su', '/sua-nhan-su', '/them-don-vi', '/them-thanh-vien']);

export interface MenuItem { group: string; path: string; label: string; icon: GlyphName; visible: boolean; badge?: number; }

export const TASK_LABELS: Record<string, string> = {
  '/cong-viec': 'Công việc', '/cong-viec/chi-tiet': 'Chi tiết công việc', '/cong-viec/tao': 'Tạo công việc', '/cong-viec/sua': 'Sửa công việc',
  '/cho-duyet': 'Chờ tôi duyệt', '/thong-ke': 'Thống kê đơn vị', '/thong-ke-ca-nhan': 'Thống kê của tôi', '/the-loai': 'Thể loại công việc',
  '/mau-cong-viec': 'Mẫu công việc', '/nhat-ky': 'Nhật ký hệ thống', '/nguy-co-tre-han': 'Nguy cơ trễ hạn', '/sao-luu': 'Sao lưu và phục hồi', '/thong-bao': 'Thông báo',
};

export function useAccess() {
  const s = useSession();
  const caps = s.tasks;
  const isAdmin = s.isAdmin;
  const viewUnitIds = [...new Set([...caps.createUnitIds, ...caps.assignUnitIds, ...caps.reviewUnitIds, ...caps.reportUnitIds])];
  const canCreate = caps.createUnitIds.length > 0;
  const canAssignAny = caps.assignUnitIds.length > 0 || caps.createUnitIds.length > 0;
  const canReviewAny = caps.reviewUnitIds.length > 0 || caps.assignUnitIds.length > 0;
  const canViewUnitStats = isAdmin || viewUnitIds.length > 0;
  const manageable = s.session?.capabilities.manageableUnitIds ?? [];
  const hasManageScope = isAdmin || manageable.length > 0;

  const orgMenu: MenuItem[] = [
    { group: 'TỔ CHỨC', path: '/to-chuc', label: 'Cơ cấu tổ chức', icon: 'sitemap', visible: hasManageScope },
    { group: 'TỔ CHỨC', path: '/nhan-su', label: 'Nhân sự', icon: 'users', visible: hasManageScope },
    { group: 'TỔ CHỨC', path: '/chuc-vu', label: 'Chức vụ và quyền', icon: 'shield', visible: isAdmin },
  ];
  const taskMenu: MenuItem[] = [
    { group: 'CÔNG VIỆC', path: '/cong-viec', label: 'Công việc', icon: 'tasks', visible: true },
    { group: 'CÔNG VIỆC', path: '/cho-duyet', label: 'Chờ tôi duyệt', icon: 'review', visible: canReviewAny },
    { group: 'CÔNG VIỆC', path: '/thong-ke', label: 'Thống kê đơn vị', icon: 'chart', visible: canViewUnitStats },
    { group: 'CÔNG VIỆC', path: '/nguy-co-tre-han', label: 'Nguy cơ trễ hạn', icon: 'alert', visible: canViewUnitStats },
    { group: 'CÔNG VIỆC', path: '/thong-ke-ca-nhan', label: 'Thống kê của tôi', icon: 'userChart', visible: caps.isMember },
    { group: 'QUẢN TRỊ CÔNG VIỆC', path: '/the-loai', label: 'Thể loại công việc', icon: 'tag', visible: isAdmin },
    { group: 'QUẢN TRỊ CÔNG VIỆC', path: '/mau-cong-viec', label: 'Mẫu công việc', icon: 'template', visible: isAdmin || canCreate },
    { group: 'QUẢN TRỊ CÔNG VIỆC', path: '/nhat-ky', label: 'Nhật ký hệ thống', icon: 'log', visible: isAdmin },
    { group: 'QUẢN TRỊ CÔNG VIỆC', path: '/sao-luu', label: 'Sao lưu và phục hồi', icon: 'download', visible: isAdmin },
  ];

  function canOpen(path: string, params: URLSearchParams): boolean {
    if (PORTAL_ICONS[path.slice(1)]) return s.portals.some((p) => '/' + p.key === path);
    switch (path) {
      case '/': case '/doi-mat-khau': return true;
      case '/ho-so': return Number(params.get('id')) === s.session?.user.id || hasManageScope;
      case '/to-chuc': case '/nhan-su': return hasManageScope;
      case '/chuc-vu': return isAdmin;
      case '/them-thanh-vien': return manageable.length > 0;
      case '/them-don-vi': return s.session?.capabilities.canCreateUnit === true;
      case '/them-nhan-su': case '/sua-nhan-su': return isAdmin;
      case '/cong-viec': case '/cong-viec/chi-tiet': case '/thong-bao': case '/cong-viec/sua': return true;
      case '/cong-viec/tao': return canCreate;
      case '/cho-duyet': return canReviewAny;
      case '/thong-ke': case '/nguy-co-tre-han': return canViewUnitStats;
      case '/thong-ke-ca-nhan': return caps.isMember || isAdmin;
      case '/the-loai': case '/nhat-ky': case '/sao-luu': return isAdmin;
      case '/mau-cong-viec': return isAdmin || canCreate;
      default: return true; // đường dẫn lạ: trang "Không tìm thấy"
    }
  }

  return { isAdmin, caps, viewUnitIds, canCreate, canAssignAny, canReviewAny, canViewUnitStats, hasManageScope, orgMenu, taskMenu, canOpen };
}
