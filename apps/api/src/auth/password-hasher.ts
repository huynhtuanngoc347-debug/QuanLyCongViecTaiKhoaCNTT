import { pbkdf2, randomBytes, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

/**
 * Băm mật khẩu tương thích ASP.NET Core Identity (PasswordHasher<T>), để dùng lại MatKhauBam trong dữ liệu mẫu.
 *  - V3 (0x01): PBKDF2, prf (0 SHA1, 1 SHA256, 2 SHA512), số vòng, muối, khóa con — số nguyên big-endian.
 *    Mặc định .NET 8: HMAC-SHA512, 100.000 vòng, muối 16 byte, khóa con 32 byte.
 *  - V2 (0x00): PBKDF2-HMAC-SHA1, 1.000 vòng, muối 16, khóa con 32 → đúng nhưng cần băm lại.
 */
export type VerifyResult = 'failed' | 'success' | 'rehash';

const ITERATIONS = 100_000;
const SALT_SIZE = 16;
const SUBKEY_SIZE = 32;
const PRF: Record<number, string> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_SIZE);
  const subkey = await pbkdf2Async(password, salt, ITERATIONS, SUBKEY_SIZE, 'sha512');
  const header = Buffer.alloc(13);
  header.writeUInt8(0x01, 0);
  header.writeUInt32BE(2, 1); // HMACSHA512
  header.writeUInt32BE(ITERATIONS, 5);
  header.writeUInt32BE(SALT_SIZE, 9);
  return Buffer.concat([header, salt, subkey]).toString('base64');
}

export async function verifyPassword(hashed: string, password: string): Promise<VerifyResult> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(hashed, 'base64');
  } catch {
    return 'failed';
  }
  if (bytes.length === 0) return 'failed';
  try {
    if (bytes[0] === 0x00) {
      if (bytes.length !== 1 + 16 + 32) return 'failed';
      const salt = bytes.subarray(1, 17), expected = bytes.subarray(17);
      const actual = await pbkdf2Async(password, salt, 1000, 32, 'sha1');
      return timingSafeEqual(actual, expected) ? 'rehash' : 'failed';
    }
    if (bytes[0] === 0x01) {
      if (bytes.length < 13) return 'failed';
      const prf = bytes.readUInt32BE(1), iterations = bytes.readUInt32BE(5), saltLength = bytes.readUInt32BE(9);
      const digest = PRF[prf];
      if (!digest || saltLength < 16 || bytes.length < 13 + saltLength + 16) return 'failed';
      const salt = bytes.subarray(13, 13 + saltLength), expected = bytes.subarray(13 + saltLength);
      const actual = await pbkdf2Async(password, salt, iterations, expected.length, digest);
      if (!timingSafeEqual(actual, expected)) return 'failed';
      return iterations < ITERATIONS || prf !== 2 ? 'rehash' : 'success';
    }
  } catch {
    return 'failed';
  }
  return 'failed';
}

/** Hash giả để thời gian xử lý tương đương khi email không tồn tại (giảm dò email). */
export const DUMMY_HASH = 'AQAAAAIAAYagAAAAEMJ/4nxXi3Hud+CxvysyT+UriqwBRmzK7gxrcQJolTHqRNlM7g19kqln7LnxMIyEyA==';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#$%&*!?';
const pick = (set: string): string => set[randomInt(set.length)];

/** Mật khẩu tạm 12 ký tự, đủ chữ hoa/thường/số/ký hiệu, bỏ ký tự dễ nhầm. */
export function generateTemporaryPassword(length = 12): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Quy tắc mật khẩu người dùng tự đặt. Trả thông báo lỗi hoặc null. */
export function validateNewPassword(password: string): string | null {
  if (password.length < 8 || password.length > 128) return 'Mật khẩu cần từ 8 đến 128 ký tự.';
  if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) return 'Mật khẩu cần có cả chữ và số.';
  if (password.trim() !== password) return 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng.';
  return null;
}

/**
 * Dấu vân tay của MatKhauBam lưu trong token. Khi mật khẩu đổi (cấp lại hoặc tự đổi),
 * dấu vân tay không còn khớp nên mọi phiên cũ bị từ chối. Không để lộ mật khẩu hay hash.
 */
export function fingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash, 'utf8').digest('hex').toUpperCase().slice(0, 16);
}
