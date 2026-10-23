import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { appConfig } from '../config';

const log = new Logger('Mailer');
const { host, port, user, pass, from } = appConfig.smtp;
// Có SMTP_USER mà chưa điền SMTP_PASS: coi như chưa cấu hình (tránh gửi lỗi xác thực mà không ai thấy mã)
const transport = host && (!user || pass) ? createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined }) : null;

/** Logo trường gắn kèm thư (cid:logo); Gmail không hiển thị ổn định ảnh WebP nên dùng PNG. */
const LOGO = path.resolve(__dirname, '..', '..', 'assets', 'email-logo.png');
export const LOGO_CID = 'logo';

/** Đã cấu hình SMTP chưa. */
export const mailEnabled = (): boolean => transport !== null;

/** Gửi email (văn bản thuần + HTML nếu có). Ném lỗi nếu máy chủ mail từ chối. */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!transport) throw new Error('Chưa cấu hình SMTP_HOST.');
  const attachments = html?.includes(`cid:${LOGO_CID}`) && fs.existsSync(LOGO) ? [{ filename: 'logo.png', path: LOGO, cid: LOGO_CID }] : undefined;
  await transport.sendMail({ from: `"Khoa Công nghệ Thông tin" <${from}>`, to, subject, text, html, attachments });
  // Không ghi tiêu đề: có thể chứa mã xác thực
  log.log(`Đã gửi email tới ${to}`);
}
