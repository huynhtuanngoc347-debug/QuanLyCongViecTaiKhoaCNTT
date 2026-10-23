import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { appConfig } from '../config';
import { FILE_PREFIX, UploadedFile, resolveStored, tryDelete } from './task-support';

/**
 * Kho tệp ngoài chuẩn S3 (bật khi có S3_BUCKET). Multer vẫn ghi tạm xuống đĩa; sau khi giao dịch thành công
 * tệp được đẩy lên kho rồi xóa bản trên đĩa. Đẩy lỗi thì giữ bản trên đĩa (vẫn tải được) — chạy lại
 * tools/upload-to-s3.mjs để đẩy sau. Khóa trên kho = tên lưu ngẫu nhiên trong DuongDan ("upload:<tên>").
 */
const log = new Logger('FileStore');
const s3 = appConfig.s3.bucket
  ? new S3Client({
    endpoint: appConfig.s3.endpoint || undefined,
    region: appConfig.s3.region,
    credentials: { accessKeyId: appConfig.s3.accessKeyId, secretAccessKey: appConfig.s3.secretAccessKey },
    forcePathStyle: true,
    // B2 và một số kho S3 khác chưa nhận checksum mặc định của SDK mới
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  : null;

const keyOf = (stored: string): string | null =>
  stored.startsWith(FILE_PREFIX) ? path.basename(stored.slice(FILE_PREFIX.length)) : null;

/** Đẩy các tệp vừa lưu thành công lên kho; không ném lỗi. */
export async function offload(files: UploadedFile[]): Promise<void> {
  if (!s3) return;
  for (const f of files) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: appConfig.s3.bucket, Key: path.basename(f.path), Body: fs.createReadStream(f.path), ContentLength: f.size,
      }));
      tryDelete(f.path);
    } catch (e) {
      log.warn(`Chưa đẩy được ${path.basename(f.path)} lên kho, giữ bản trên đĩa: ${(e as Error).message}`);
    }
  }
}

/** Mở nội dung tệp: bản trên đĩa nếu còn, không thì lấy từ kho. null = không có nội dung. */
export async function openStored(stored: string): Promise<{ local: string } | { stream: Readable; size?: number } | null> {
  const local = resolveStored(stored);
  if (local) return { local };
  const key = keyOf(stored);
  if (!s3 || !key) return null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: appConfig.s3.bucket, Key: key }));
    return r.Body ? { stream: r.Body as Readable, size: r.ContentLength } : null;
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchKey') return null;
    throw e;
  }
}

/** Xóa nội dung tệp ở cả đĩa và kho; không ném lỗi. */
export async function removeStored(stored: string): Promise<void> {
  const local = resolveStored(stored);
  if (local) tryDelete(local);
  const key = keyOf(stored);
  if (!s3 || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: appConfig.s3.bucket, Key: key }));
  } catch (e) {
    log.warn(`Chưa xóa được ${key} trên kho: ${(e as Error).message}`);
  }
}
