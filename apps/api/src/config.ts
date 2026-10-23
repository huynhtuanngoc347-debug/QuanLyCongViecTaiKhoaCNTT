import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { config as loadEnv } from 'dotenv';

/**
 * Cấu hình đọc từ biến môi trường (tệp apps/api/.env, xem .env.example).
 * Không đặt mật khẩu CSDL hay khóa JWT trong mã nguồn.
 */
const apiRoot = path.resolve(__dirname, '..');
for (const file of ['.env', '.env.local']) {
  const full = path.join(apiRoot, file);
  if (fs.existsSync(full)) loadEnv({ path: full, override: file === '.env.local' });
}

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();
const flag = (key: string, fallback: boolean): boolean => {
  const v = env(key).toLowerCase();
  return v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v);
};

const generatedSecret = !env('JWT_SECRET');

export const appConfig = {
  port: Number(env('PORT', '5080')) || 5080,
  production: env('NODE_ENV') === 'production',
  db: {
    /** tedious: tài khoản SQL (User/Password). msnodesqlv8: Windows (Trusted_Connection) qua ODBC Driver 17/18. */
    driver: (env('DB_DRIVER', 'tedious').toLowerCase() === 'msnodesqlv8' ? 'msnodesqlv8' : 'tedious') as 'tedious' | 'msnodesqlv8',
    server: env('DB_SERVER', 'localhost'),
    instance: env('DB_INSTANCE'),
    port: env('DB_PORT') ? Number(env('DB_PORT')) : undefined,
    database: env('DB_NAME', 'QLCongViecKhoaCNTT'),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    encrypt: flag('DB_ENCRYPT', false),
    trustServerCertificate: flag('DB_TRUST_SERVER_CERTIFICATE', true),
    /** Dùng cho msnodesqlv8, ví dụ: Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=QLCongViecKhoaCNTT;Trusted_Connection=yes; */
    connectionString: env('DB_CONNECTION_STRING'),
  },
  jwt: {
    secret: env('JWT_SECRET') || randomBytes(48).toString('base64url'),
    generatedSecret,
    accessTtlSeconds: Number(env('JWT_ACCESS_TTL_SECONDS', '900')) || 900,
    refreshTtlSeconds: Number(env('JWT_REFRESH_TTL_SECONDS', String(7 * 24 * 3600))) || 7 * 24 * 3600,
  },
  cookies: {
    /** Bật khi chạy qua HTTPS. Mặc định tự nhận theo yêu cầu (req.secure). */
    secure: env('COOKIE_SECURE').toLowerCase(),
  },
  corsOrigins: env('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  webDist: path.resolve(apiRoot, env('WEB_DIST', '../web/dist')),
  mobileDist: path.resolve(apiRoot, env('MOBILE_DIST', '../mobile/dist')),
  uploadsPath: path.resolve(apiRoot, env('UPLOADS_PATH', 'App_Data/uploads')),
  /** Kho tệp chuẩn S3 (Backblaze B2, Cloudflare R2…). Bỏ trống S3_BUCKET = chỉ lưu trên đĩa. */
  s3: {
    bucket: env('S3_BUCKET'),
    endpoint: env('S3_ENDPOINT'),
    region: env('S3_REGION', 'auto'),
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
  },
  /** Gửi email (quên mật khẩu). Bỏ trống SMTP_HOST: không gửi, mã chỉ in ra cửa sổ chạy API (khi không phải production). */
  smtp: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '465')) || 465,
    user: env('SMTP_USER'),
    // Google hiển thị mật khẩu ứng dụng thành 4 nhóm cách nhau: bỏ khoảng trắng
    pass: env('SMTP_PASS').replace(/\s+/g, ''),
    from: env('MAIL_FROM') || env('SMTP_USER'),
  },
  /** Tác vụ nền nhắc hạn + lặp lại (phút). 0 = tắt. */
  reminderIntervalMinutes: Number(env('REMINDER_INTERVAL_MINUTES', '60')),
};
