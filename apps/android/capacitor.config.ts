import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Ứng dụng Android chỉ là khung mở bản web trên máy chủ (cùng origin → cookie đăng nhập hoạt động, chức năng luôn giống bản web).
 * Mặc định 10.0.2.2 = máy tính đang chạy máy ảo Android. Điện thoại thật: SERVER_URL=http://<ip-máy-chủ>:5080 npm run sync.
 */
const url = process.env.SERVER_URL || 'http://10.0.2.2:5080';

const config: CapacitorConfig = {
  appId: 'vn.edu.huit.khoacntt',
  appName: 'Công việc Khoa',
  webDir: 'www',
  server: { url, cleartext: url.startsWith('http:') },
  // Bản web nhận ra đang chạy trong ứng dụng (api/client.ts openFile).
  appendUserAgent: 'KhoaAndroid',
};

export default config;
