import type { NextFunction, Request, Response } from 'express';

/**
 * Header bảo mật cho mọi phản hồi.
 * - Chống clickjacking: không cho trang khác nhúng giao diện vào <iframe> (X-Frame-Options + CSP frame-ancestors).
 * - Không đoán kiểu nội dung; không gửi Referer ra ngoài; API không lưu bộ nhớ đệm.
 * CSP ở đây CHỈ có frame-ancestors để không chặn font/ảnh hiện có; trang xem tệp (/api/tep?xem=1) tự đặt CSP sandbox riêng.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
}
