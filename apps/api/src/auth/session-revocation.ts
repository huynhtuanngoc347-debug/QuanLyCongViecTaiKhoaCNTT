import { randomBytes } from 'node:crypto';
import type { SqlRunner } from '../db/db.service';

/**
 * Thu hồi phiên khi đăng xuất (sql/05_ThuHoiPhien.sql).
 * Mỗi lần đăng nhập có một mã phiên; refresh giữ nguyên mã. Đăng xuất ghi mã vào dbo.PhienDaThuHoi,
 * guard và refresh từ chối mọi token mang mã đó. Chưa có bảng thì bỏ qua (hành vi cũ).
 */
const HAS_TABLE = "OBJECT_ID(N'dbo.PhienDaThuHoi', N'U') IS NOT NULL";

export const newSessionId = (): string => randomBytes(16).toString('hex');

export const isSessionId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);

/** Câu lệnh đặt @DaThuHoi = 1 nếu @sid đã bị thu hồi; ghép trước câu SELECT cần cột này. */
export const REVOKED_PREFIX = `DECLARE @DaThuHoi BIT = 0;
IF @sid IS NOT NULL AND ${HAS_TABLE}
  IF EXISTS (SELECT 1 FROM dbo.PhienDaThuHoi WHERE MaPhien = @sid) SET @DaThuHoi = 1;`;

export async function isRevoked(db: SqlRunner, sid: string | undefined): Promise<boolean> {
  if (!isSessionId(sid)) return false;
  return (await db.scalar<boolean | number>(`${REVOKED_PREFIX}\nSELECT @DaThuHoi;`, { sid })) ? true : false;
}

/** Ghi thu hồi; dọn các dòng đã hết tác dụng. Trả về false nếu chưa có bảng. */
export async function revokeSession(db: SqlRunner, sid: string, userId: number, ttlSeconds: number): Promise<boolean> {
  if (!isSessionId(sid)) return false;
  const done = await db.scalar<number>(
    `IF ${HAS_TABLE}
     BEGIN
       DELETE FROM dbo.PhienDaThuHoi WHERE HetHan < SYSUTCDATETIME();
       IF NOT EXISTS (SELECT 1 FROM dbo.PhienDaThuHoi WHERE MaPhien = @sid)
         INSERT dbo.PhienDaThuHoi (MaPhien, MaNguoiDung, HetHan) VALUES (@sid, @userId, DATEADD(SECOND, @ttl, SYSUTCDATETIME()));
       SELECT 1;
     END
     ELSE SELECT 0;`,
    { sid, userId, ttl: ttlSeconds },
  );
  return done === 1;
}
