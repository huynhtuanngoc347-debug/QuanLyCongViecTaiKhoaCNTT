import { ApiException } from '../common/result';

/**
 * Chặn dò mật khẩu: CHỈ đếm lần nhập SAI (đăng nhập hoặc mật khẩu hiện tại khi đổi mật khẩu).
 * - Theo cặp IP + tài khoản: quá `perAccount` lần sai trong cửa sổ → khóa tài khoản đó trên IP đó.
 * - Theo IP: quá `perIp` lần sai (mọi tài khoản cộng lại) → khóa IP (chống thử hàng loạt tài khoản).
 * Đăng nhập đúng xóa bộ đếm của tài khoản; không tính vào giới hạn — cả khoa ra Internet chung một IP vẫn đăng nhập bình thường.
 */
export interface ThrottleOptions { windowMs: number; perAccount: number; perIp: number; }
const DEFAULTS: ThrottleOptions = { windowMs: 5 * 60 * 1000, perAccount: 10, perIp: 50 };

export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; start: number }>();
  constructor(private readonly opts: ThrottleOptions = DEFAULTS, private readonly now: () => number = Date.now) {}

  private static ipKey(ip: string | null): string { return `ip:${ip ?? 'unknown'}`; }
  private static accountKey(ip: string | null, account: string): string { return `acct:${ip ?? 'unknown'}|${account.trim().toLowerCase()}`; }

  private countOf(key: string): number {
    const e = this.failures.get(key);
    if (!e) return 0;
    if (this.now() - e.start >= this.opts.windowMs) { this.failures.delete(key); return 0; }
    return e.count;
  }

  private bump(key: string): void {
    const t = this.now();
    const e = this.failures.get(key);
    if (!e || t - e.start >= this.opts.windowMs) this.failures.set(key, { count: 1, start: t });
    else e.count++;
  }

  /** Còn được thử không (gọi TRƯỚC khi kiểm tra mật khẩu). */
  isBlocked(ip: string | null, account: string): boolean {
    return this.countOf(LoginThrottle.accountKey(ip, account)) >= this.opts.perAccount
      || this.countOf(LoginThrottle.ipKey(ip)) >= this.opts.perIp;
  }

  /** Ném 429 nếu đang bị khóa. */
  assertAllowed(ip: string | null, account: string): void {
    if (this.isBlocked(ip, account)) throw new ApiException(429, 'Nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 5 phút.');
  }

  /** Ghi nhận một lần nhập sai. */
  recordFailure(ip: string | null, account: string): void {
    this.bump(LoginThrottle.accountKey(ip, account));
    this.bump(LoginThrottle.ipKey(ip));
    this.prune();
  }

  /** Nhập đúng: xóa bộ đếm của tài khoản (bộ đếm IP giữ nguyên để không "rửa" được bằng một tài khoản thật). */
  recordSuccess(ip: string | null, account: string): void {
    this.failures.delete(LoginThrottle.accountKey(ip, account));
  }

  private prune(): void {
    if (this.failures.size <= 5000) return;
    const t = this.now();
    for (const [k, v] of this.failures) if (t - v.start >= this.opts.windowMs) this.failures.delete(k);
  }
}

/** Bộ chặn dùng chung cho cả tiến trình API. */
export const loginThrottle = new LoginThrottle();
