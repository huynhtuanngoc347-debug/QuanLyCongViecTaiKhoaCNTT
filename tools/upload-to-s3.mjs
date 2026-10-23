// Đẩy các tệp còn nằm trên đĩa (UPLOADS_PATH) lên kho S3 đã khai báo trong apps/api/.env, rồi xóa bản trên đĩa.
// Dùng khi mới bật kho, hoặc khi API báo "Chưa đẩy được ... lên kho". Chạy lại nhiều lần vẫn an toàn.
// Chạy: node tools/upload-to-s3.mjs [--keep]   (--keep: giữ bản trên đĩa sau khi đẩy)
//       node tools/upload-to-s3.mjs --check    (chỉ thử kết nối kho)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api');
loadEnv({ path: path.join(apiRoot, '.env') });
const env = (k, d = '') => (process.env[k] ?? d).trim();
const bucket = env('S3_BUCKET');
if (!bucket) {
  console.error('Chưa khai báo S3_BUCKET trong apps/api/.env.');
  process.exit(1);
}
const keep = process.argv.includes('--keep');
const dir = path.resolve(apiRoot, env('UPLOADS_PATH', 'App_Data/uploads'));
const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT') || undefined,
  region: env('S3_REGION', 'auto'),
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

if (process.argv.includes('--check')) {
  // Thử ghi → đọc → xóa một tệp nhỏ; không đụng tệp thật
  const Key = `kiem-tra-ket-noi-${Date.now()}.txt`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: 'ok' }));
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
    const text = await r.Body.transformToString();
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    if (text !== 'ok') throw new Error('nội dung đọc lại không khớp');
    console.log(`Kết nối kho "${bucket}" tốt: ghi, đọc, xóa đều được.`);
    process.exit(0);
  } catch (e) {
    console.error(`Kết nối kho "${bucket}" lỗi: ${e.name}: ${e.message}`);
    process.exit(1);
  }
}

const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()) : [];
let done = 0, failed = 0;
for (const name of names) {
  const full = path.join(dir, name);
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: name, Body: fs.readFileSync(full) }));
    if (!keep) fs.unlinkSync(full);
    done++;
    console.log(`Đã đẩy ${name}`);
  } catch (e) {
    failed++;
    console.error(`Lỗi ${name}: ${e.message}`);
  }
}
console.log(`Xong: ${done} tệp đã đẩy, ${failed} lỗi (thư mục ${dir}).`);
process.exit(failed ? 1 : 0);
