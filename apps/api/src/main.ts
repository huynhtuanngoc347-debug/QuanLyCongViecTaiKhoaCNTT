import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule, CUSTOM_UNIT_TYPE_SQL, TASK_MODULE_SQL } from './app.module';
import { appConfig } from './config';
import { securityHeaders } from './common/security-headers';
import { mobileRedirect } from './common/mobile-redirect';
import { DbService } from './db/db.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('KhoaCNTT');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '2mb' });
  app.use(cookieParser());
  app.use(securityHeaders);
  if (appConfig.corsOrigins.length > 0) {
    app.enableCors({ origin: appConfig.corsOrigins, credentials: true });
  }
  // Phục vụ luôn giao diện React đã build (cùng origin → cookie SameSite=Strict hoạt động).
  // App di động (apps/mobile) tại /m/ — đăng ký trước giao diện máy tính để không bị thư mục gốc che.
  // Điện thoại dùng bản web; đường dẫn /m/... cũ chuyển sang trang tương ứng của bản web (xem common/mobile-redirect.ts).
  app.use('/m', mobileRedirect);
  if (fs.existsSync(path.join(appConfig.webDist, 'index.html'))) {
    app.useStaticAssets(appConfig.webDist, { index: 'index.html', maxAge: '1h', setHeaders: (res, file) => { if (!/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'no-cache'); } }); // chỉ assets/ có mã băm trong tên; còn lại (index.html, styles.css...) phải kiểm tra lại mỗi lần
    logger.log(`Phục vụ giao diện từ ${appConfig.webDist}`);
  } else {
    logger.warn(`Chưa có giao diện đã build tại ${appConfig.webDist}. Chạy "npm run build" ở thư mục gốc, hoặc dùng "npm run dev:web" khi phát triển.`);
  }
  if (appConfig.jwt.generatedSecret) {
    logger.warn('Chưa đặt JWT_SECRET trong apps/api/.env: dùng khóa tạm, mọi phiên đăng nhập mất khi khởi động lại.');
  }
  app.enableShutdownHooks();
  await app.listen(appConfig.port);
  logger.log(`API chạy tại http://localhost:${appConfig.port} (kiểm tra: /api/health)`);

  // Kiểm tra CSDL lúc khởi động: báo rõ script nào chưa chạy.
  try {
    const db = app.get(DbService);
    const [customTypes, taskModule] = await db.read(async (r) => [await r.scalar<boolean>(CUSTOM_UNIT_TYPE_SQL), await r.scalar<boolean>(TASK_MODULE_SQL)]);
    if (!customTypes) logger.warn('CK_DV_Loai vẫn giới hạn 5 loại đơn vị. Chạy sql/02_MoRong_LoaiDonVi.sql để cho phép nhập loại mới.');
    if (!taskModule) logger.warn('Chưa chạy sql/03_PhanHeCongViec.sql: các màn hình Công việc sẽ báo lỗi. Chạy script này trong SSMS rồi khởi động lại.');
    else logger.log('Kết nối SQL Server thành công.');
  } catch (e) {
    logger.error(`Không kết nối được SQL Server: ${(e as Error).message}. Kiểm tra DB_* trong apps/api/.env.`);
  }
}

void bootstrap();
