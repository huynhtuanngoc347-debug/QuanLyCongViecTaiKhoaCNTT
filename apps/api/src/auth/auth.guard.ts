import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { DbService } from '../db/db.service';
import { ApiException } from '../common/result';
import { fingerprint } from './password-hasher';
import { REVOKED_PREFIX, isSessionId } from './session-revocation';

export const ACCESS_COOKIE = 'khoa_at';
export const REFRESH_COOKIE = 'khoa_rt';

export interface AuthUser { id: number; name: string; sid?: string; }
/** sid: mã phiên đăng nhập (giữ nguyên khi refresh, bị thu hồi khi đăng xuất). Token cũ không có sid vẫn hợp lệ tới khi hết hạn. */
export interface TokenPayload { sub: number; name: string; fp: string; typ: 'access' | 'refresh'; sid?: string; }

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
 * tài khoản còn hoạt động, mật khẩu chưa đổi (dấu vân tay khớp) và phiên chưa bị thu hồi khi đăng xuất
 * — bị khóa / cấp lại mật khẩu / đăng xuất thì phiên cũ hết hiệu lực ngay.
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
    const sid = isSessionId(payload.sid) ? payload.sid : undefined;
    const account = await this.db.read((db) =>
      db.one<{ TrangThaiTaiKhoan: boolean; MatKhauBam: string; DaThuHoi: boolean }>(
        `${REVOKED_PREFIX}
         SELECT TrangThaiTaiKhoan, MatKhauBam, @DaThuHoi AS DaThuHoi FROM dbo.NguoiDung WHERE MaNguoiDung = @id;`,
        { id: payload.sub, sid: sid ?? null },
      ),
    );
    if (!account || !account.TrangThaiTaiKhoan || account.DaThuHoi || fingerprint(account.MatKhauBam) !== payload.fp) {
      clearAuthCookies(res);
      throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');
    }
    req.user = { id: payload.sub, name: payload.name, sid };
    return true;
  }
}

/** Giới hạn đăng nhập: xem login-throttle.ts (chỉ đếm lần nhập sai, theo IP + tài khoản). */
