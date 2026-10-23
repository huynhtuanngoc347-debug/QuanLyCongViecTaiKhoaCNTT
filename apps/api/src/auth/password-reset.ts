import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { SqlRunner } from '../db/db.service';
import { appConfig } from '../config';
import { mailEnabled, sendMail } from '../common/mailer';
import { LoginThrottle } from './login-throttle';

/**
 * Quên mật khẩu: mã 6 chữ số gửi qua email, lưu HMAC trong dbo.MaDatLaiMatKhau (sql/06_DatLaiMatKhau.sql).
 * Mã hết hạn sau RESET_MINUTES phút, bị hủy sau RESET_MAX_TRIES lần nhập sai; mã mới thay mã cũ.
 */
export const RESET_MINUTES = 10;
export const RESET_MAX_TRIES = 5;
/** Giây tối thiểu giữa hai lần gửi mã cho cùng một tài khoản. */
export const RESET_RESEND_SECONDS = 60;

/** Giới hạn theo IP + email cho cả gửi mã và nhập mã (15 phút). */
export const resetLimiter = new LoginThrottle({ windowMs: 15 * 60 * 1000, perAccount: 5, perIp: 30 });

const log = new Logger('PasswordReset');

export const newResetCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** HMAC theo khóa JWT: lộ bảng mã cũng không dò ngược được mã (khóa không nằm trong CSDL). */
export const hashResetCode = (userId: number, code: string): string =>
  createHmac('sha256', appConfig.jwt.secret).update(`${userId}:${code}`).digest('hex');

export function sameHash(stored: string, computed: string): boolean {
  const a = Buffer.from(stored.trim().toLowerCase()), b = Buffer.from(computed);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hasResetTable(db: SqlRunner): Promise<boolean> {
  return (await db.scalar<number>("SELECT CASE WHEN OBJECT_ID(N'dbo.MaDatLaiMatKhau', N'U') IS NULL THEN 0 ELSE 1 END;")) === 1;
}

const SCHOOL = 'Trường Đại học Công Thương Thành phố Hồ Chí Minh';
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Giờ hết hạn theo giờ Việt Nam, ví dụ "09:05 ngày 23/10/2026". */
const vnTime = (d: Date): string => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ngày ${p.day}/${p.month}/${p.year}`;
};

/** Thư mã xác thực: bản văn bản thuần và bản HTML (bảng + CSS nội dòng để Gmail/Outlook hiển thị đúng). */
export function resetEmail(name: string, code: string, expires: Date): { subject: string; text: string; html: string } {
  const until = vnTime(expires);
  const subject = 'Mã xác thực đặt lại mật khẩu';
  const text = `Xin chào ${name},\n\n`
    + 'Bạn vừa yêu cầu đặt lại mật khẩu Hệ thống quản lý công việc Khoa Công nghệ Thông tin. Mã xác thực của bạn là:\n\n'
    + `    ${code}\n\n`
    + `Mã có hiệu lực ${RESET_MINUTES} phút (đến ${until}) và chỉ dùng được một lần.\n`
    + 'Không chia sẻ mã này cho bất kỳ ai, kể cả người tự xưng là cán bộ của khoa.\n'
    + 'Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại vẫn giữ nguyên.\n\n'
    + `Khoa Công nghệ Thông tin — ${SCHOOL}\nĐây là email tự động, vui lòng không trả lời.`;
  const font = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#eef2f7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Mã xác thực của bạn: ${code} — hiệu lực ${RESET_MINUTES} phút.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;${font}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08)">
    <tr><td style="background:#0455a0;padding:28px 32px" align="center">
      <img src="cid:logo" width="64" height="64" alt="Logo ${SCHOOL}" style="display:block;border:0;width:64px;height:64px;background:#ffffff;border-radius:50%;padding:4px">
      <div style="margin-top:12px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px">Khoa Công nghệ Thông tin</div>
      <div style="margin-top:4px;color:#cfe0f5;font-size:13px">${SCHOOL}</div>
    </td></tr>
    <tr><td style="padding:32px 32px 8px;color:#1e293b;font-size:15px;line-height:1.6">
      <div style="font-size:21px;font-weight:700;color:#0f172a;margin-bottom:12px">Đặt lại mật khẩu</div>
      <p style="margin:0 0 12px">Xin chào <strong>${esc(name)}</strong>,</p>
      <p style="margin:0 0 20px">Bạn vừa yêu cầu đặt lại mật khẩu <strong>Hệ thống quản lý công việc</strong>. Nhập mã dưới đây vào trang đặt lại mật khẩu:</p>
    </td></tr>
    <tr><td align="center" style="padding:0 32px">
      <!-- Một dãy số liền (giãn chữ) để chép/dán được nguyên mã trên điện thoại -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f1f6fc;border:1px dashed #9db9dd;border-radius:14px"><tr>
        <td style="padding:16px 20px 16px 30px;font-family:Consolas,'Courier New',monospace;font-size:36px;line-height:1;font-weight:700;letter-spacing:10px;color:#0455a0">${code}</td>
      </tr></table>
      <div style="margin-top:12px;color:#64748b;font-size:13px">Có hiệu lực <strong style="color:#0f172a">${RESET_MINUTES} phút</strong> · đến ${until} · chỉ dùng một lần</div>
    </td></tr>
    <tr><td style="padding:24px 32px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-left:4px solid #f59e0b;border-radius:8px">
        <tr><td style="padding:12px 16px;color:#7c2d12;font-size:13.5px;line-height:1.55">
          <strong>Không chia sẻ mã này cho bất kỳ ai</strong>, kể cả người tự xưng là cán bộ của khoa.
          Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 32px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;line-height:1.6" align="center">
      Email tự động từ Hệ thống quản lý công việc Khoa Công nghệ Thông tin.<br>Vui lòng không trả lời email này.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  return { subject, text, html };
}

/** Gửi mã qua email; chưa cấu hình SMTP thì in mã ra cửa sổ chạy API (chỉ khi không phải production). Không ném lỗi. */
export async function deliverResetCode(email: string, name: string, code: string): Promise<void> {
  if (!mailEnabled()) {
    if (appConfig.production) log.error(`Chưa cấu hình SMTP, không gửi được mã đặt lại mật khẩu cho ${email}.`);
    else log.warn(`[Chưa cấu hình SMTP — chỉ dùng khi thử] Mã đặt lại mật khẩu cho ${email}: ${code}`);
    return;
  }
  try {
    const m = resetEmail(name, code, new Date(Date.now() + RESET_MINUTES * 60_000));
    await sendMail(email, m.subject, m.text, m.html);
  } catch (e) {
    log.error(`Không gửi được mã đặt lại mật khẩu tới ${email}: ${(e as Error).message}`);
  }
}
