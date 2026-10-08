import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { LoginResponseDto, SessionDto, TokenPairDto } from '@khoa/shared';
import { DbService, SqlRunner } from '../db/db.service';
import { appConfig } from '../config';
import { ApiException, FieldErrorsException } from '../common/result';
import { writeAudit } from '../common/audit-log';
import { initials, toStr } from '../common/text';
import { loadRights } from '../tasks/task-access';
import { capabilities, loadActiveUser, portals } from './access.service';
import {
  ACCESS_COOKIE, REFRESH_COOKIE, AuthUser, ClientIp, CurrentUser, Public, TokenPayload, checkLoginRate, clearAuthCookies,
} from './auth.guard';
import { DUMMY_HASH, fingerprint, hashPassword, validateNewPassword, verifyPassword } from './password-hasher';

interface LoginRow { MaNguoiDung: number; HoTen: string; Email: string; MatKhauBam: string; TrangThaiTaiKhoan: boolean; }

/** Phiên đăng nhập: người dùng, quyền tổ chức, trang theo vai trò, quyền phân hệ Công việc. */
export async function loadSession(db: SqlRunner, userId: number): Promise<SessionDto | null> {
  const user = await loadActiveUser(db, userId);
  if (!user) return null;
  const roleSummary = await db.scalar<string>('SELECT ChucVuHienThi FROM dbo.vw_HoSoNguoiDung WHERE MaNguoiDung = @userId;', { userId });
  const caps = await capabilities(db, user);
  const userPortals = await portals(db, user);
  const rights = await loadRights(db, userId);
  return {
    user: {
      id: user.MaNguoiDung, name: user.HoTen, initials: initials(user.HoTen), email: user.Email, isSystemAdmin: !!user.LaQuanTriHeThong,
      roleSummary: roleSummary && roleSummary.trim() ? roleSummary : user.LaQuanTriHeThong ? 'Quản trị viên hệ thống' : 'Chưa có chức vụ',
    },
    capabilities: caps,
    portals: userPortals,
    tasks: rights?.toDto() ?? { createUnitIds: [], assignUnitIds: [], reviewUnitIds: [], reportUnitIds: [], isMember: false },
  };
}

/**
 * Đăng nhập bằng email + mật khẩu (MatKhauBam theo ASP.NET Core Identity V3).
 * Web: access token + refresh token trong cookie httpOnly, SameSite=Strict.
 * App di động: gửi header "X-Client: mobile" để nhận token trong thân phản hồi, rồi dùng Authorization: Bearer.
 */
@Controller('api/auth')
export class AuthController {
  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}

  private isMobile(req: Request): boolean {
    return String(req.headers['x-client'] ?? '').toLowerCase() === 'mobile';
  }

  private async issue(req: Request, res: Response, userId: number, name: string, fp: string): Promise<TokenPairDto> {
    const { accessTtlSeconds, refreshTtlSeconds } = appConfig.jwt;
    const accessToken = await this.jwt.signAsync({ sub: userId, name, fp, typ: 'access' } satisfies TokenPayload, { expiresIn: accessTtlSeconds });
    const refreshToken = await this.jwt.signAsync({ sub: userId, name, fp, typ: 'refresh' } satisfies TokenPayload, { expiresIn: refreshTtlSeconds });
    const secure = appConfig.cookies.secure === 'true' ? true : appConfig.cookies.secure === 'false' ? false : req.secure;
    const base = { httpOnly: true, sameSite: 'strict' as const, secure };
    res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: accessTtlSeconds * 1000 });
    res.cookie(REFRESH_COOKIE, refreshToken, { ...base, path: '/api/auth', maxAge: refreshTtlSeconds * 1000 });
    return { accessToken, refreshToken, accessExpiresIn: accessTtlSeconds };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null): Promise<LoginResponseDto> {
    checkLoginRate(ip);
    const email = (toStr(body?.email) ?? '').trim();
    const password = toStr(body?.password) ?? '';
    const errors: Record<string, string> = {};
    if (email.length === 0 || email.length > 254) errors.email = 'Nhập email đăng nhập.';
    if (password.length === 0 || password.length > 256) errors.password = 'Nhập mật khẩu.';
    if (Object.keys(errors).length) throw new FieldErrorsException(errors);

    const outcome = await this.db.tx(null, async (db) => {
      // Cột Email dùng collation không phân biệt hoa/thường.
      const user = await db.one<LoginRow>('SELECT MaNguoiDung, HoTen, Email, MatKhauBam, TrangThaiTaiKhoan FROM dbo.NguoiDung WHERE Email = @email;', { email });
      const verify = await verifyPassword(user?.MatKhauBam ?? DUMMY_HASH, password);
      if (!user) return null;
      if (verify === 'failed' || !user.TrangThaiTaiKhoan) {
        await writeAudit(db, user.MaNguoiDung, user.TrangThaiTaiKhoan ? 'DangNhapThatBai' : 'DangNhapTaiKhoanBiKhoa', 'NguoiDung', String(user.MaNguoiDung), null, null, ip);
        return null;
      }
      let currentHash = user.MatKhauBam;
      if (verify === 'rehash') {
        currentHash = await hashPassword(password);
        await db.exec('UPDATE dbo.NguoiDung SET MatKhauBam = @hash WHERE MaNguoiDung = @id;', { hash: currentHash, id: user.MaNguoiDung });
      }
      await writeAudit(db, user.MaNguoiDung, 'DangNhap', 'NguoiDung', String(user.MaNguoiDung), null, null, ip);
      return { id: user.MaNguoiDung, name: user.HoTen, fp: fingerprint(currentHash) };
    });
    // Không tiết lộ email có tồn tại hay tài khoản bị khóa.
    if (!outcome) throw new ApiException(401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản đang bị khóa.');

    const tokens = await this.issue(req, res, outcome.id, outcome.name, outcome.fp);
    const session = await this.db.read((db) => loadSession(db, outcome.id));
    if (!session) throw new ApiException(401, 'Tài khoản không còn hiệu lực.');
    return this.isMobile(req) ? { ...session, tokens } : session;
  }

  /** Cấp lại cặp token từ refresh token (cookie, hoặc { refreshToken } trong thân cho app di động). */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true; tokens?: TokenPairDto }> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const token = toStr(body?.refreshToken) || cookies?.[REFRESH_COOKIE];
    if (!token) throw new ApiException(401, 'Vui lòng đăng nhập.');
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      clearAuthCookies(res);
      throw new ApiException(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
    if (payload.typ !== 'refresh') throw new ApiException(401, 'Vui lòng đăng nhập.');
    const account = await this.db.read((db) =>
      db.one<{ HoTen: string; TrangThaiTaiKhoan: boolean; MatKhauBam: string }>('SELECT HoTen, TrangThaiTaiKhoan, MatKhauBam FROM dbo.NguoiDung WHERE MaNguoiDung = @id;', { id: payload.sub }),
    );
    if (!account || !account.TrangThaiTaiKhoan || fingerprint(account.MatKhauBam) !== payload.fp) {
      clearAuthCookies(res);
      throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');
    }
    const tokens = await this.issue(req, res, payload.sub, account.HoTen, payload.fp);
    return this.isMobile(req) ? { ok: true, tokens } : { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null): Promise<void> {
    await this.db.tx(user.id, (db) => writeAudit(db, user.id, 'DangXuat', 'NguoiDung', String(user.id), null, null, ip));
    clearAuthCookies(res);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<SessionDto> {
    const session = await this.db.read((db) => loadSession(db, user.id));
    if (!session) {
      clearAuthCookies(res);
      throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực.');
    }
    return session;
  }

  /** Tự đổi mật khẩu. Các phiên khác bị đăng xuất (dấu vân tay đổi); phiên hiện tại được cấp token mới. */
  @Post('doi-mat-khau')
  @HttpCode(204)
  async changePassword(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null): Promise<void> {
    checkLoginRate(ip);
    const current = toStr(body?.currentPassword) ?? '';
    const next = toStr(body?.newPassword) ?? '';
    const errors: Record<string, string> = {};
    if (current.length === 0) errors.currentPassword = 'Nhập mật khẩu hiện tại.';
    const rule = validateNewPassword(next);
    if (rule) errors.newPassword = rule;
    else if (next === current) errors.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    if (Object.keys(errors).length) throw new FieldErrorsException(errors);

    const newHash = await hashPassword(next);
    const result = await this.db.tx(user.id, async (db) => {
      const row = await db.one<LoginRow>('SELECT MaNguoiDung, HoTen, Email, MatKhauBam, TrangThaiTaiKhoan FROM dbo.NguoiDung WITH (UPDLOCK, HOLDLOCK) WHERE MaNguoiDung = @id;', { id: user.id });
      if (!row || !row.TrangThaiTaiKhoan) return { status: 401 as const, name: '' };
      if ((await verifyPassword(row.MatKhauBam, current)) === 'failed') {
        await writeAudit(db, user.id, 'DoiMatKhauThatBai', 'NguoiDung', String(user.id), null, null, ip);
        return { status: 400 as const, name: '' };
      }
      await db.exec('UPDATE dbo.NguoiDung SET MatKhauBam = @newHash WHERE MaNguoiDung = @id;', { newHash, id: user.id });
      await writeAudit(db, user.id, 'DoiMatKhau', 'NguoiDung', String(user.id), null, null, ip);
      return { status: 200 as const, name: row.HoTen };
    });
    if (result.status === 401) throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực.');
    if (result.status === 400) throw new FieldErrorsException({ currentPassword: 'Mật khẩu hiện tại không đúng.' });
    const tokens = await this.issue(req, res, user.id, result.name, fingerprint(newHash));
    if (this.isMobile(req)) {
      res.status(200);
      return { tokens } as unknown as void;
    }
  }
}
