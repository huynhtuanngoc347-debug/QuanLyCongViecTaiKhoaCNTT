import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, HttpException, Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { appConfig } from './config';
import { DbService } from './db/db.service';
import { AuthGuard, Public } from './auth/auth.guard';
import { ApiException } from './common/result';
import { AuthController } from './auth/auth.controller';
import { OrganizationController } from './organization/organization.controller';
import { OrganizationCommands } from './organization/organization.commands';
import { PortalController, StaffController } from './staff/staff.controller';
import { StaffCommands } from './staff/staff.commands';
import { TasksController } from './tasks/tasks.controller';
import { TaskCommands } from './tasks/task.commands';
import { CatalogService } from './tasks/catalog.service';
import { ReminderScheduler } from './tasks/notifications';

/** Loại đơn vị tự nhập cần sql/02_MoRong_LoaiDonVi.sql (bỏ giới hạn 5 mã của CK_DV_Loai). */
export const CUSTOM_UNIT_TYPE_SQL = `SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.DonVi')
  AND name = N'CK_DV_Loai' AND definition LIKE N'%BoMon%') THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END;`;

/** Phân hệ Công việc cần sql/03_PhanHeCongViec.sql (YeuCauGiaHan, MauCongViec, PhanCong.VaiTro…). */
export const TASK_MODULE_SQL = `SELECT CASE WHEN OBJECT_ID(N'dbo.YeuCauGiaHan', N'U') IS NOT NULL AND OBJECT_ID(N'dbo.MauCongViec', N'U') IS NOT NULL
  AND COL_LENGTH(N'dbo.PhanCong', N'VaiTro') IS NOT NULL AND COL_LENGTH(N'dbo.CongViec', N'MaMauCongViec') IS NOT NULL
  THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;`;

@Controller('api/health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  /** Kiểm tra kết nối CSDL và các script bổ sung đã chạy chưa. */
  @Public()
  @Get()
  async health(): Promise<{ database: string; customUnitTypes: boolean; taskModule: boolean; server: string }> {
    return this.db.read(async (db) => ({
      database: 'ok',
      customUnitTypes: (await db.scalar<boolean>(CUSTOM_UNIT_TYPE_SQL)) === true,
      taskModule: (await db.scalar<boolean>(TASK_MODULE_SQL)) === true,
      server: 'nestjs',
    }));
  }
}

/**
 * Định dạng lỗi thống nhất cho giao diện: { message, errors? }. Không lộ chi tiết SQL ra trình duyệt.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Loi');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let status = 500;
    let body: { message: string; errors?: Record<string, string> } = { message: 'Máy chủ gặp lỗi. Vui lòng thử lại sau.' };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse() as { message?: unknown; errors?: Record<string, string> } | string;
      const raw = typeof payload === 'string' ? payload : Array.isArray(payload?.message) ? payload.message.join(' ') : String(payload?.message ?? '');
      if (exception instanceof ApiException) {
        body = payload as typeof body;
      } else if (status === 413) {
        body = { message: 'Tệp quá lớn. Mỗi tệp tối đa 20 MB.', errors: { files: 'Mỗi tệp tối đa 20 MB.' } };
        status = 400;
      } else if (/too many files|unexpected field/i.test(raw)) {
        body = { message: 'Vui lòng kiểm tra các trường được đánh dấu.', errors: { files: 'Tối đa 10 tệp mỗi lần nộp.' } };
        status = 400;
      } else if (status === 400) {
        body = { message: 'Dữ liệu gửi lên không đúng định dạng.' };
      } else if (status === 404) {
        body = { message: 'Không tìm thấy đường dẫn API.' };
      } else if (status === 401) {
        body = { message: 'Vui lòng đăng nhập.' };
      } else if (status === 403) {
        body = { message: 'Bạn không có quyền thực hiện thao tác này.' };
      } else {
        body = { message: raw || 'Không thực hiện được thao tác.' };
      }
    } else if ((exception as { type?: string })?.type === 'entity.too.large') {
      // Lỗi của body-parser (thân JSON vượt giới hạn 2 MB) không phải HttpException → trước đây rơi xuống 500.
      status = 413;
      body = { message: 'Dữ liệu gửi lên quá lớn (tối đa 2 MB).' };
    } else if ((exception as { type?: string })?.type === 'entity.parse.failed') {
      status = 400;
      body = { message: 'Dữ liệu gửi lên không đúng định dạng.' };
    } else if ((exception as Error)?.name === 'ConnectionError') {
      status = 503;
      body = { message: 'Không kết nối được SQL Server. Kiểm tra SQL Server đang chạy và cấu hình DB_* trong apps/api/.env.' };
      this.logger.error(`Không kết nối được SQL Server: ${(exception as Error).message}`);
    } else {
      this.logger.error(`Lỗi không xử lý tại ${req.method} ${req.originalUrl}: ${(exception as Error)?.message}`, (exception as Error)?.stack);
    }
    if (!res.headersSent) res.status(status).json(body);
  }
}

@Module({
  imports: [JwtModule.register({ global: true, secret: appConfig.jwt.secret })],
  controllers: [HealthController, AuthController, OrganizationController, StaffController, PortalController, TasksController],
  providers: [
    DbService, OrganizationCommands, StaffCommands, TaskCommands, CatalogService, ReminderScheduler,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
