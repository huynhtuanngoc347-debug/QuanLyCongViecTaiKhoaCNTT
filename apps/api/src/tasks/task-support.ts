import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '../db/db.service';
import { appConfig } from '../config';
import { cut } from '../common/text';

/** Loại thông báo (CK_TB_Loai). */
export const N = {
  Assign: 'GiaoViec', Comment: 'BinhLuan', Result: 'KetQua', DueSoon: 'SapDenHan', Overdue: 'QuaHan', Slow: 'ChamTienDo',
  System: 'HeThong', Extension: 'GiaHan', Accept: 'TiepNhan', Recurrence: 'LapLai',
} as const;

/** Ghi dbo.ThongBao trong cùng giao dịch với thao tác nghiệp vụ. Không gửi email/push. */
export async function notify(
  db: SqlRunner, recipients: Iterable<number>, taskId: number | null, type: string, level: number,
  title: string, content: string, needsAction = false, exceptUserId: number | null = null,
): Promise<void> {
  const ids = [...new Set([...recipients].filter((id) => id !== exceptUserId))];
  for (const id of ids) {
    await db.exec(
      `INSERT dbo.ThongBao (MaNguoiNhan, MaCongViec, LoaiThongBao, MucDo, TieuDe, NoiDung, CanXuLy)
       VALUES (@id, @taskId, @type, @level, @title, @content, @needsAction);`,
      { id, taskId, type, level, title: cut(title, 250), content: content.trim() ? content : title, needsAction },
    );
  }
}

/** Đánh dấu đã xử lý các thông báo "cần xử lý" của người này trên công việc (sau khi duyệt/quyết định). */
export function markHandled(db: SqlRunner, userId: number, taskId: number, type: string): Promise<number> {
  return db.exec(
    `UPDATE dbo.ThongBao
     SET NgayXuLy = SYSUTCDATETIME(), DaDoc = 1,
         NgayDoc = COALESCE(NgayDoc, CASE WHEN SYSUTCDATETIME() >= NgayTao THEN SYSUTCDATETIME() ELSE NgayTao END)
     WHERE MaNguoiNhan = @userId AND MaCongViec = @taskId AND LoaiThongBao = @type AND CanXuLy = 1 AND NgayXuLy IS NULL;`,
    { userId, taskId, type },
  );
}

/** Ghi dbo.LichSuCongViec cho sự kiện ở bảng khác (trigger chỉ tự ghi thay đổi của dbo.CongViec). */
export function logHistory(
  db: SqlRunner, taskId: number, userId: number, type: string, description: string,
  field: string | null = null, oldValue: string | null = null, newValue: string | null = null,
): Promise<number> {
  return db.exec(
    `INSERT dbo.LichSuCongViec (MaCongViec, MaNguoiThucHien, LoaiHanhDong, MoTa, TruongThayDoi, GiaTriCu, GiaTriMoi)
     VALUES (@taskId, @userId, @type, @description, @field, @oldValue, @newValue);`,
    { taskId, userId, type: cut(type, 50), description: cut(description, 1000), field, oldValue, newValue },
  );
}

/**
 * Tệp đính kèm lưu trên đĩa máy chủ (UPLOADS_PATH, mặc định App_Data/uploads).
 * CSDL chỉ lưu metadata; DuongDan = "upload:" + tên ngẫu nhiên. Dữ liệu mẫu "/demo/..." không tải được.
 */
export const FILE_PREFIX = 'upload:';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 10;
export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.rar', '.7z'];

export interface UploadedFile { originalname: string; size: number; mimetype: string; path: string; filename: string; }

export function validateFiles(files: UploadedFile[]): string | null {
  if (files.length > MAX_FILES) return `Tối đa ${MAX_FILES} tệp mỗi lần nộp.`;
  for (const f of files) {
    if (f.size === 0) return `Tệp “${f.originalname}” rỗng.`;
    if (f.size > MAX_FILE_BYTES) return `Tệp “${f.originalname}” lớn hơn 20 MB.`;
    if (!ALLOWED_EXTENSIONS.includes(path.extname(f.originalname).toLowerCase()))
      return `Không nhận tệp “${f.originalname}”. Chỉ nhận: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  }
  return null;
}

export const uploadsRoot = (): string => {
  fs.mkdirSync(appConfig.uploadsPath, { recursive: true });
  return appConfig.uploadsPath;
};

/** Tên lưu ngẫu nhiên giữ đuôi tệp (không dùng tên người dùng đặt). */
export const storedName = (originalName: string): string => `${randomUUID().replace(/-/g, '')}${path.extname(originalName).toLowerCase()}`;

/** Đường dẫn vật lý của tệp hệ thống đã lưu; null nếu không phải tệp do hệ thống lưu hoặc không còn trên đĩa. */
export function resolveStored(storedPath: string): string | null {
  if (!storedPath.startsWith(FILE_PREFIX)) return null;
  const root = path.resolve(appConfig.uploadsPath);
  const full = path.resolve(root, path.basename(storedPath.slice(FILE_PREFIX.length)));
  if (!full.startsWith(root) || !fs.existsSync(full)) return null;
  return full;
}

export function tryDelete(fullPath: string): void {
  try {
    fs.unlinkSync(fullPath);
  } catch {
    /* dọn tệp khi lỗi: không chặn phản hồi */
  }
}

export function safeFileName(name: string): string {
  const clean = path.basename(name.replace(/\\/g, '/')).trim();
  return clean.length <= 255 ? clean : clean.slice(-255);
}
