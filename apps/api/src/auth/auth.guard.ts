import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { DbService } from '../db/db.service';
import { ApiException } from '../common/result';
import { fingerprint } from './password-hasher';

export const ACCESS_COOKIE = 'khoa_at';
export const REFRESH_COOKIE = 'khoa_rt';

export interface AuthUser { id: number; name: string; }
export interface TokenPayload { sub: number; name: string; fp: string; typ: 'access' | 'refresh'; }

/** Đánh dấu endpoint không cần đăng nhập. */
export const IS_PUBLIC = 'khoa:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Người dùng đã xác thực (lấy từ token, không bao giờ lấy từ form). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!req.user) throw new ApiException(401, 'Vui lòng đăng nhập lại.');
  return req.user;
});

/** Địa chỉ IP người gọi (ghi nhật ký). */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? req.socket?.remoteAddress ?? null;
});

/** Lấy token: web dùng cookie httpOnly, app di động dùng header Authorization: Bearer. */
export function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[ACCESS_COOKIE] || null;
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

/**
 * Bảo vệ mọi endpoint (trừ @Public). Mỗi yêu cầu kiểm tra lại trong CSDL:
 * tài khoản còn hoạt động và mật khẩu chưa đổi (dấu vân tay khớp) — bị khóa / cấp lại mật khẩu thì phiên cũ hết hiệu lực ngay.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const token = readAccessToken(req);
    if (!token) throw new ApiException(401, 'Vui lòng đăng nhập.');
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new ApiException(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
    if (payload.typ !== 'access' || !Number.isInteger(payload.sub)) throw new ApiException(401, 'Vui lòng đăng nhập.');
    const account = await this.db.read((db) =>
      db.one<{ TrangThaiTaiKhoan: boolean; MatKhauBam: string }>(
        'SELECT TrangThaiTaiKhoan, MatKhauBam FROM dbo.NguoiDung WHERE MaNguoiDung = @id;',
        { id: payload.sub },
      ),
    );
    if (!account || !account.TrangThaiTaiKhoan || fingerprint(account.MatKhauBam) !== payload.fp) {
      clearAuthCookies(res);
      throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');
    }
    req.user = { id: payload.sub, name: payload.name };
    return true;
  }
}

/** Giới hạn đăng nhập 10 lần / 5 phút / IP (dùng chung cho đăng nhập và đổi mật khẩu). */
const WINDOW_MS = 5 * 60 * 1000;
const LIMIT = 10;
const attempts = new Map<string, { count: number; start: number }>();

export function checkLoginRate(ip: string | null): void {
  const key = ip ?? 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
    attempts.set(key, { count: 1, start: now });
  } else {
    entry.count++;
    if (entry.count > LIMIT) throw new ApiException(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút.');
  }
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now - v.start >= WINDOW_MS) attempts.delete(k);
  }
}
