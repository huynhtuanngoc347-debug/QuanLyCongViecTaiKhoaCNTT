import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { NotificationListDto } from '@khoa/shared';
import { DbService, SqlRunner } from '../db/db.service';
import { appConfig } from '../config';
import { iso, localText, nowUtc, DAY_MS } from '../common/vn-time';
import { unitManagers } from './task-access';
import { N, notify } from './task-support';
import { runRecurrence } from './catalog.service';

export async function listNotifications(db: SqlRunner, userId: number, unreadOnly: boolean, limit: number): Promise<NotificationListDto> {
  const rows = await db.query<{ MaThongBao: number; LoaiThongBao: string; MucDo: number; TieuDe: string; NoiDung: string; MaCongViec: number | null; DaDoc: boolean; CanXuLy: boolean; NgayXuLy: Date | null; NgayTao: Date }>(
    `SELECT TOP (@limit) MaThongBao, LoaiThongBao, MucDo, TieuDe, NoiDung, MaCongViec, DaDoc, CanXuLy, NgayXuLy, NgayTao
     FROM dbo.ThongBao
     WHERE MaNguoiNhan = @userId AND (@unreadOnly = 0 OR DaDoc = 0)
     ORDER BY NgayTao DESC, MaThongBao DESC;`,
    { userId, unreadOnly, limit: Math.min(100, Math.max(1, limit)) },
  );
  const unread = (await db.scalar<number>('SELECT COUNT(*) FROM dbo.ThongBao WHERE MaNguoiNhan = @userId AND DaDoc = 0;', { userId })) ?? 0;
  return {
    items: rows.map((n) => ({
      id: n.MaThongBao, type: n.LoaiThongBao, level: n.MucDo, title: n.TieuDe, content: n.NoiDung, taskId: n.MaCongViec,
      read: !!n.DaDoc, needsAction: !!n.CanXuLy && n.NgayXuLy == null, createdAt: iso(n.NgayTao)!,
    })),
    unread,
  };
}

/** Đánh dấu đã đọc; id = null: tất cả thông báo của người này. Không đánh dấu thông báo của người khác. */
export function markRead(db: DbService, userId: number, id: number | null): Promise<number> {
  return db.tx(userId, (tx) =>
    tx.exec(
      `UPDATE dbo.ThongBao
       SET DaDoc = 1, NgayDoc = CASE WHEN SYSUTCDATETIME() >= NgayTao THEN SYSUTCDATETIME() ELSE NgayTao END
       WHERE MaNguoiNhan = @userId AND DaDoc = 0 AND (@id IS NULL OR MaThongBao = @id);`,
      { userId, id },
    ),
  );
}

interface DueRow { MaPhanCong: number; MaCongViec: number; TieuDe: string; HanHoanThanh: Date; MaNguoiNhan: number | null; MaDonViNhan: number | null; TenDonViNhan: string | null; MaNguoiGiao: number; TenNguoiNhan: string | null; }

/**
 * Nhắc hạn: thông báo SapDenHan (còn ≤ 3 ngày) / QuaHan cho người thực hiện (và người giao khi quá hạn),
 * mỗi người mỗi công việc tối đa 1 lần trong 20 giờ. Không gửi email.
 */
export async function runDueReminders(db: DbService): Promise<number> {
  const rows = await db.read((r) =>
    r.query<DueRow>(
      `SELECT p.MaPhanCong, p.MaCongViec, c.TieuDe, p.HanHoanThanh, p.MaNguoiNhan, p.MaDonViNhan, d.TenDonVi AS TenDonViNhan,
              p.MaNguoiGiao, n.HoTen AS TenNguoiNhan
       FROM dbo.PhanCong AS p
       JOIN dbo.CongViec AS c ON c.MaCongViec = p.MaCongViec
       LEFT JOIN dbo.DonVi AS d ON d.MaDonVi = p.MaDonViNhan
       LEFT JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = p.MaNguoiNhan
       WHERE p.TrangThaiPhanCong IN (0, 1, 2) AND c.TrangThai IN (1, 2)
         AND p.HanHoanThanh <= DATEADD(DAY, 3, SYSUTCDATETIME());`,
    ),
  );
  let sent = 0;
  const now = nowUtc();
  for (const row of rows) {
    sent += await db.tx(null, async (tx) => {
      const overdue = row.HanHoanThanh < now;
      const type = overdue ? N.Overdue : N.DueSoon;
      const assignees = row.MaNguoiNhan != null ? [row.MaNguoiNhan] : await unitManagers(tx, row.MaDonViNhan!);
      const recipients = overdue ? [...new Set([...assignees, row.MaNguoiGiao])] : assignees;
      let count = 0;
      for (const who of recipients) {
        const recent = await tx.scalar<number>(
          `SELECT COUNT(*) FROM dbo.ThongBao
           WHERE MaNguoiNhan = @who AND MaCongViec = @task AND LoaiThongBao = @type AND NgayTao > DATEADD(HOUR, -20, SYSUTCDATETIME());`,
          { who, task: row.MaCongViec, type },
        );
        if ((recent ?? 0) > 0) continue;
        const isAssigner = who === row.MaNguoiGiao && !assignees.includes(who);
        const days = Math.ceil((row.HanHoanThanh.getTime() - now.getTime()) / DAY_MS);
        const title = overdue ? `Quá hạn: ${row.TieuDe}` : `Sắp đến hạn: ${row.TieuDe}`;
        const content = overdue
          ? isAssigner
            ? `${row.TenNguoiNhan ?? row.TenDonViNhan} chưa hoàn thành, quá hạn từ ${localText(row.HanHoanThanh)}.`
            : `Đã quá hạn từ ${localText(row.HanHoanThanh)}. Cập nhật tiến độ hoặc xin gia hạn.`
          : `Còn ${Math.max(days, 0)} ngày (hạn ${localText(row.HanHoanThanh)}).`;
        await notify(tx, [who], row.MaCongViec, type, overdue ? 2 : 1, title, content);
        count++;
      }
      return count;
    });
  }
  return sent;
}

/** Tác vụ nền: mỗi giờ nhắc hạn và tạo bản nháp cho mẫu lặp lại đã đến kỳ. */
@Injectable()
export class ReminderScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NhacHan');
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly db: DbService) {}

  onApplicationBootstrap(): void {
    const minutes = appConfig.reminderIntervalMinutes;
    if (!minutes || minutes <= 0) return;
    this.first = setTimeout(() => void this.tick(), 20_000);
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
  }

  async tick(): Promise<{ reminders: number; drafts: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const reminders = await runDueReminders(this.db);
      const drafts = await runRecurrence(this.db);
      if (reminders + drafts > 0) this.logger.log(`Nhắc hạn: ${reminders} thông báo; lặp lại: ${drafts} bản nháp.`);
      return { reminders, drafts };
    } catch (e) {
      // Chưa chạy 03_PhanHeCongViec.sql hoặc mất kết nối: ghi log, thử lại lần sau.
      this.logger.warn(`Tác vụ nhắc hạn lỗi; sẽ thử lại sau: ${(e as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
