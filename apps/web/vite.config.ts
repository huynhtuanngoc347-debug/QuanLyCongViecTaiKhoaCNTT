import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// public/styles.css không qua Vite nên tên tệp không có mã băm: gắn ?v=<băm nội dung> khi build
// để trình duyệt tải bản mới ngay sau mỗi lần sửa thay vì dùng bản cũ trong bộ nhớ đệm.
function versionPublicCss(): Plugin {
  return {
    name: 'version-public-css',
    apply: 'build',
    transformIndexHtml(html) {
      const v = createHash('sha1').update(readFileSync(new URL('./public/styles.css', import.meta.url))).digest('hex').slice(0, 10);
      return html.replace(/href="(\.?\/)styles\.css"/, `href="$1styles.css?v=${v}"`);
    },
  };
}

// Khi phát triển: giao diện chạy ở http://localhost:5173, chuyển tiếp /api sang NestJS (cổng 5080)
// để cookie đăng nhập dùng chung một origin.
export default defineConfig({
  plugins: [react(), versionPublicCss()],
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:5080', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
