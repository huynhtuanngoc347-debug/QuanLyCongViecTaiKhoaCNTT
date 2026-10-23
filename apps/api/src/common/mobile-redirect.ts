import type { NextFunction, Request, Response } from 'express';

/**
 * Điện thoại dùng chung bản web (đã tối ưu khổ nhỏ) để mọi chức năng — nhất là giao việc — luôn giống nhau.
 * App riêng /m/ (apps/mobile) không còn được phục vụ; đường dẫn /m/... cũ (dấu trang, thông báo cũ)
 * được chuyển sang đúng trang tương ứng của bản web. Phần sau dấu # không gửi lên máy chủ nên phải đổi ở trình duyệt.
 */
const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Đang chuyển…</title>
<style>body{font:15px system-ui,sans-serif;color:#475569;display:grid;place-items:center;min-height:100vh;margin:0}</style></head>
<body><p>Đang chuyển sang bản web…</p>
<script>
(async function () {
  var h = (location.hash || '#/').slice(1);
  var path = h.split('?')[0], query = new URLSearchParams(h.split('?')[1] || '');
  var m, to = '/';
  if (path === '/tasks' || path === '/filter') to = query.get('scope') === 'review' ? '/cho-duyet' : '/cong-viec';
  else if (path === '/review') to = '/cho-duyet';
  else if ((m = path.match(/^\\/tasks\\/(\\d+)(\\/.*)?$/))) to = '/cong-viec/chi-tiet?id=' + m[1];
  else if (path === '/create') to = '/cong-viec/tao';
  else if (path === '/notifications') to = '/thong-bao';
  else if (path === '/profile') {
    try {
      var r = await fetch('/api/auth/me', { credentials: 'include' });
      if (r.ok) to = '/ho-so?id=' + (await r.json()).user.id;
    } catch (e) { /* chưa đăng nhập: về trang chủ */ }
  }
  location.replace('/#' + to);
})();
</script></body></html>`;

export function mobileRedirect(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(PAGE);
}
