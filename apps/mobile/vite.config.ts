import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// App di động: build ra dist/ và được NestJS phục vụ tại /m/ (cùng origin với API → dùng chung cookie đăng nhập).
// Khi phát triển: http://localhost:5174/m/, chuyển tiếp /api sang NestJS (cổng 5080).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/m/',
  server: {
    port: 5174,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:5080', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
