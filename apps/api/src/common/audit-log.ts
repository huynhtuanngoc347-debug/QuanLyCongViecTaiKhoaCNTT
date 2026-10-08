import type { SqlRunner } from '../db/db.service';

/**
 * Ghi dbo.NhatKyHeThong trong CÙNG giao dịch với thao tác quản trị.
 * Không bao giờ truyền mật khẩu, mật khẩu băm hay token vào đây.
 */
export function writeAudit(
  db: SqlRunner,
  userId: number | null,
  action: string,
  objectType: string | null,
  objectId: string | null,
  oldData: unknown,
  newData: unknown,
  ip: string | null,
): Promise<number> {
  return db.exec(
    `INSERT dbo.NhatKyHeThong (MaNguoiThaoTac, HanhDong, LoaiDoiTuong, DinhDanhDoiTuong, DuLieuCu, DuLieuMoi, DiaChiIP)
     VALUES (@userId, @action, @objectType, @objectId, @oldData, @newData, @ip);`,
    {
      userId,
      action,
      objectType,
      objectId,
      oldData: oldData == null ? null : JSON.stringify(oldData),
      newData: newData == null ? null : JSON.stringify(newData),
      ip: ip == null ? null : ip.slice(0, 45),
    },
  );
}
