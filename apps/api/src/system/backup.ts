import { Controller, Delete, Get, HttpCode, Logger, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { BackupDto } from '@khoa/shared';
import { FILE_PREFIX } from '../tasks/task-support';
import { openStored } from '../tasks/file-store';
import { appConfig } from '../config';
import { DbService, sqlErrorMessage } from '../db/db.service';
import { ApiException } from '../common/result';
import { writeAudit } from '../common/audit-log';
import { iso } from '../common/vn-time';
import { AuthUser, ClientIp, CurrentUser } from '../auth/auth.guard';

/** Tên backupset do ứng dụng tạo; chỉ liệt kê / phục hồi các bản này (không đụng bản sao lưu do người khác tạo). */
const BACKUP_SET = 'khoa-cntt';
/** Bản sao thư mục tệp đính kèm, đặt cạnh thư mục uploads: backups/<tên tệp .bak không đuôi>/ */
const filesRoot = () => path.resolve(appConfig.uploadsPath, '..', 'backups');
const filesDir = (fileName: string) => path.join(filesRoot(), path.basename(fileName, path.extname(fileName)));

interface BackupRow { id: number; at: Date; size: number; note: string | null; device: string; }

const LIST_SQL = `SELECT TOP (50) b.backup_set_id AS id,
       DATEADD(MINUTE, DATEDIFF(MINUTE, GETDATE(), GETUTCDATE()), b.backup_finish_date) AS at,
       CAST(b.backup_size AS FLOAT) AS size, b.description AS note, m.physical_device_name AS device
FROM msdb.dbo.backupset AS b JOIN msdb.dbo.backupmediafamily AS m ON m.media_set_id = b.media_set_id
WHERE b.database_name = DB_NAME() AND b.name = N'${BACKUP_SET}' AND b.type = 'D'`;

/**
 * Tệp .bak còn trên đĩa. shortcut: máy chủ API không đọc được thư mục sao lưu (SQL Server ở máy khác) thì coi như còn,
 * khi đó tải về / xóa sẽ báo lỗi; muốn hỗ trợ thì phải đọc/xóa qua SQL Server (OPENROWSET, xp_delete_file).
 */
const bakExists = (device: string) => !fs.existsSync(path.dirname(device)) || fs.existsSync(device);

const toDto = (b: BackupRow): BackupDto => {
  const fileName = b.device.split(/[\\/]/).pop() ?? b.device;
  // Kích thước thật của tệp .bak (backup_size của msdb không tính phần đầu tệp); không đọc được thì dùng số của msdb.
  const sizeBytes = fs.existsSync(b.device) ? fs.statSync(b.device).size : Number(b.size) || 0;
  return { id: b.id, fileName, at: iso(b.at)!, sizeBytes, note: b.note ?? '', hasFiles: fs.existsSync(filesDir(fileName)) };
};

/**
 * Sao lưu / phục hồi (chỉ quản trị hệ thống):
 *  - CSDL: BACKUP DATABASE vào thư mục sao lưu mặc định của SQL Server (dịch vụ SQL Server luôn ghi được ở đó).
 *  - Tệp đính kèm: chép thư mục UPLOADS_PATH sang backups/<tên bản sao lưu>/; tệp chỉ còn trên kho S3 được tải về thư mục đó.
 *  - Phục hồi: tự sao lưu trạng thái hiện tại trước, rồi RESTORE (ngắt mọi kết nối khác), chép lại tệp đính kèm còn thiếu.
 * Tài khoản SQL của API cần quyền sysadmin (hoặc db_backupoperator + dbcreator).
 */
@Controller('api/sao-luu')
export class BackupController {
  private readonly logger = new Logger('SaoLuu');
  /** Chỉ một thao tác sao lưu/phục hồi chạy cùng lúc. */
  private busy = false;

  constructor(private readonly db: DbService) {}

  private async requireAdmin(userId: number): Promise<void> {
    const admin = await this.db.read((db) => db.scalar<boolean>('SELECT LaQuanTriHeThong FROM dbo.NguoiDung WHERE MaNguoiDung = @userId AND TrangThaiTaiKhoan = 1;', { userId }));
    if (admin !== true) throw new ApiException(403, 'Chỉ quản trị hệ thống được sao lưu và phục hồi dữ liệu.');
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ApiException(409, 'Đang có thao tác sao lưu hoặc phục hồi khác. Vui lòng đợi.');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }

  private async audit(userId: number, action: string, id: string, data: unknown, ip: string | null): Promise<void> {
    // Sau phục hồi, người thao tác có thể không còn trong CSDL cũ: ghi người thao tác = null.
    await this.db.tx(userId, async (db) => {
      const exists = await db.scalar<number>('SELECT COUNT(*) FROM dbo.NguoiDung WHERE MaNguoiDung = @userId;', { userId });
      await writeAudit(db, exists ? userId : null, action, 'SaoLuu', id, null, data, ip);
    });
  }

  private async backup(note: string): Promise<BackupDto> {
    // Có mili giây: bản tự động trước khi phục hồi không trùng tên (WITH INIT sẽ ghi đè) bản vừa tạo cùng giây.
    const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 17);
    let row: BackupRow | null;
    try {
      row = await this.db.longRunning((db) => db.one<BackupRow>(
        `DECLARE @db SYSNAME = DB_NAME();
         DECLARE @dir NVARCHAR(4000) = CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(4000));
         DECLARE @file NVARCHAR(4000) = @dir + CASE WHEN RIGHT(@dir, 1) IN (N'\\', N'/') THEN N'' ELSE N'\\' END + @db + N'_' + @stamp + N'.bak';
         BACKUP DATABASE @db TO DISK = @file WITH INIT, CHECKSUM, NAME = N'${BACKUP_SET}', DESCRIPTION = @note;
         ${LIST_SQL} ORDER BY b.backup_set_id DESC;`,
        { stamp, note: note.slice(0, 255) },
      ));
    } catch (e) {
      this.logger.error(`Sao lưu CSDL lỗi: ${sqlErrorMessage(e)}`);
      throw new ApiException(500, 'Không sao lưu được CSDL. Kiểm tra tài khoản SQL của máy chủ có quyền sao lưu và ổ đĩa còn chỗ trống.');
    }
    if (!row) throw new ApiException(500, 'Đã chạy sao lưu nhưng không thấy bản ghi trong msdb.');
    const dto = toDto(row);
    const dir = filesDir(dto.fileName);
    if (fs.existsSync(appConfig.uploadsPath)) fs.cpSync(appConfig.uploadsPath, dir, { recursive: true });
    const skippedFiles = await this.pullFromS3(dir);
    return { ...dto, hasFiles: fs.existsSync(dir), skippedFiles };
  }

  /** Kho S3 đang bật: tải về các tệp đính kèm không còn trên đĩa để bản sao lưu đủ tệp. Trả số tệp không tải được. */
  private async pullFromS3(dir: string): Promise<number> {
    if (!appConfig.s3.bucket) return 0;
    const rows = await this.db.read((db) => db.query<{ DuongDan: string }>(
      `SELECT DISTINCT DuongDan FROM dbo.TepDinhKem WHERE LEFT(DuongDan, LEN(@prefix)) = @prefix;`, { prefix: FILE_PREFIX }));
    fs.mkdirSync(dir, { recursive: true });
    let skipped = 0;
    for (const { DuongDan } of rows) {
      const dest = path.join(dir, path.basename(DuongDan.slice(FILE_PREFIX.length)));
      if (fs.existsSync(dest)) continue;
      try {
        const content = await openStored(DuongDan);
        if (content && 'stream' in content) await pipeline(content.stream, fs.createWriteStream(dest));
      } catch (e) {
        skipped++;
        fs.rmSync(dest, { force: true });
        this.logger.warn(`Không tải được ${DuongDan} từ kho S3 vào bản sao lưu: ${(e as Error).message}`);
      }
    }
    return skipped;
  }

  /** Bản sao lưu theo mã, chỉ trong các bản do ứng dụng tạo và tệp .bak còn trên đĩa. */
  private async find(id: number): Promise<BackupRow> {
    const row = await this.db.read((db) => db.one<BackupRow>(`${LIST_SQL} AND b.backup_set_id = @id;`, { id }));
    if (!row || !bakExists(row.device)) throw new ApiException(404, 'Không tìm thấy bản sao lưu hoặc tệp đã bị xóa.');
    return row;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<BackupDto[]> {
    await this.requireAdmin(user.id);
    const rows = await this.db.read((db) => db.query<BackupRow>(`${LIST_SQL} ORDER BY b.backup_set_id DESC;`));
    return rows.filter((b) => bakExists(b.device)).map(toDto);
  }

  /** Tải tệp .bak về máy (cất giữ ở nơi khác phòng hỏng ổ đĩa máy chủ). */
  @Get(':id/tai-ve')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    await this.requireAdmin(user.id);
    const row = await this.find(id);
    res.setHeader('Cache-Control', 'no-store');
    res.download(row.device, toDto(row).fileName, (e) => {
      if (!e) return;
      this.logger.error(`Không gửi được tệp sao lưu ${row.device}: ${e.message}`);
      if (!res.headersSent) res.status(500).json({ message: 'Máy chủ không đọc được tệp sao lưu.' });
    });
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ClientIp() ip: string | null): Promise<{ deleted: true }> {
    await this.requireAdmin(user.id);
    return this.exclusive(async () => {
      const row = await this.find(id);
      const fileName = toDto(row).fileName;
      try {
        fs.rmSync(row.device);
      } catch (e) {
        this.logger.error(`Không xóa được ${row.device}: ${(e as Error).message}`);
        throw new ApiException(500, 'Máy chủ không xóa được tệp sao lưu (thiếu quyền ghi thư mục sao lưu của SQL Server).');
      }
      fs.rmSync(filesDir(fileName), { recursive: true, force: true });
      await this.audit(user.id, 'Xóa bản sao lưu', String(id), { file: fileName }, ip);
      return { deleted: true as const };
    });
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<BackupDto> {
    await this.requireAdmin(user.id);
    return this.exclusive(async () => {
      const dto = await this.backup(`Sao lưu thủ công bởi ${user.name}`);
      await this.audit(user.id, 'Sao lưu dữ liệu', String(dto.id), { file: dto.fileName }, ip);
      return dto;
    });
  }

  @Post(':id/phuc-hoi')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ClientIp() ip: string | null): Promise<{ restored: BackupDto; safety: BackupDto }> {
    await this.requireAdmin(user.id);
    return this.exclusive(async () => {
      // Đường dẫn tệp chỉ lấy từ msdb theo mã, không nhận đường dẫn từ trình duyệt.
      const row = await this.find(id);
      const target = toDto(row);
      // Giữ lại trạng thái hiện tại để còn quay lại nếu phục hồi nhầm.
      const safety = await this.backup(`Tự động trước khi phục hồi bản ${target.fileName}`);
      try {
        await this.db.longRunning((db) => db.exec(
          `DECLARE @db SYSNAME = DB_NAME();
           DECLARE @single NVARCHAR(400) = N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE;';
           DECLARE @multi NVARCHAR(400) = N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET MULTI_USER;';
           USE master;
           EXEC (@single);
           BEGIN TRY
             RESTORE DATABASE @db FROM DISK = @file WITH REPLACE, CHECKSUM;
           END TRY
           BEGIN CATCH
             EXEC (@multi);
             THROW;
           END CATCH;
           EXEC (@multi);`,
          { file: row.device },
        ));
      } catch (e) {
        this.logger.error(`Phục hồi CSDL lỗi: ${sqlErrorMessage(e)}`);
        throw new ApiException(500, `Không phục hồi được CSDL (dữ liệu hiện tại giữ nguyên, đã sao lưu thành ${safety.fileName}). Kiểm tra tệp sao lưu còn trên máy chủ.`);
      } finally {
        // Kết nối của pool đã bị ngắt hoặc đang ở master: tạo pool mới.
        await this.db.reset();
      }
      // Tên tệp đính kèm là ngẫu nhiên, không đổi: chỉ chép tệp còn thiếu, không ghi đè, không xóa tệp mới hơn.
      const dir = filesDir(target.fileName);
      if (fs.existsSync(dir)) fs.cpSync(dir, appConfig.uploadsPath, { recursive: true, force: false });
      await this.audit(user.id, 'Phục hồi dữ liệu', String(id), { file: target.fileName, safety: safety.fileName }, ip);
      return { restored: target, safety };
    });
  }
}
