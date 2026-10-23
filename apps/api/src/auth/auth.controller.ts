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
  ACCESS_COOKIE, REFRESH_COOKIE, AuthUser, ClientIp, CurrentUser, Public, TokenPayload, clearAuthCookies,
} from './auth.guard';
import { loginThrottle } from './login-throttle';
import { isRevoked, isSessionId, newSessionId, revokeSession } from './session-revocation';
import { DUMMY_HASH, fingerprint, hashPassword, validateNewPassword, verifyPassword } from './password-hasher';
import {
  RESET_MAX_TRIES, RESET_MINUTES, RESET_RESEND_SECONDS, deliverResetCode, hasResetTable, hashResetCode, newResetCode, resetLimiter, sameHash,
} from './password-reset';
import { isValidEmail } from '../staff/staff.commands';

interface LoginRow { MaNguoiDung: number; HoTen: string; Email: string; MatKhauBam: string; TrangThaiTaiKhoan: boolean; }

/** Phiên đăng nhập: người dùng, quyền tổ chức, trang theo vai trò, quyền phân hệ Công việc. */
export async function loadSession(db: SqlRunner, userId: number): Promise<SessionDto | null> {
  const user = await loadActiveUser(db, userId);
  if (!user) return null;
  // Cùng điều kiện với vw_HoSoNguoiDung, nhưng chức vụ nhiều quyền đứng trước (view xếp theo chữ cái)
  const roleNames = (await db.query<{ TenChucVu: string }>(
    `DECLARE @HomNay DATE = CONVERT(DATE, SYSUTCDATETIME());
     SELECT c.TenChucVu
     FROM dbo.ThanhVienDonVi AS tv
     JOIN dbo.ChucVu AS c ON c.MaChucVu = tv.MaChucVu
     JOIN dbo.DonVi AS dv ON dv.MaDonVi = tv.MaDonVi
     WHERE tv.MaNguoiDung = @userId AND tv.TrangThai = 1 AND c.TrangThai = 1 AND dv.TrangThai = 1
       AND tv.NgayThamGia <= @HomNay AND (tv.NgayKetThuc IS NULL OR tv.NgayKetThuc >= @HomNay)
     GROUP BY c.TenChucVu
     ORDER BY MAX(CAST(c.DuocQuanLyThanhVien AS INT) + CAST(c.DuocTaoCongViec AS INT) + CAST(c.DuocGiaoViec AS INT)
                + CAST(c.DuocDuyetKetQua AS INT) + CAST(c.DuocDanhGia AS INT) + CAST(c.DuocXemBaoCaoDonVi AS INT)
                + CAST(c.ApDungChoDonViCon AS INT)) DESC, c.TenChucVu;`, { userId })).map((r) => r.TenChucVu);
  // "Thành viên" chỉ là tư cách chung — bỏ khi đã có chức vụ cụ thể
  const named = roleNames.filter((n) => n.trim().toLowerCase() !== 'thành viên');
  const roleSummary = (named.length ? named : roleNames).join('; ');
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

  /** sid: mã phiên — đăng nhập tạo mới, refresh / đổi mật khẩu giữ nguyên (xem session-revocation.ts). */
  private async issue(req: Request, res: Response, userId: number, name: string, fp: string, sid: string): Promise<TokenPairDto> {
    const { accessTtlSeconds, refreshTtlSeconds } = appConfig.jwt;
    const accessToken = await this.jwt.signAsync({ sub: userId, name, fp, typ: 'access', sid } satisfies TokenPayload, { expiresIn: accessTtlSeconds });
    const refreshToken = await this.jwt.signAsync({ sub: userId, name, fp, typ: 'refresh', sid } satisfies TokenPayload, { expiresIn: refreshTtlSeconds });
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
    const email = (toStr(body?.email) ?? '').trim();
    const password = toStr(body?.password) ?? '';
    const errors: Record<string, string> = {};
    if (email.length === 0 || email.length > 254) errors.email = 'Nhập email đăng nhập.';
    if (password.length === 0 || password.length > 256) errors.password = 'Nhập mật khẩu.';
    if (Object.keys(errors).length) throw new FieldErrorsException(errors);
    // Chỉ chặn khi đã nhập SAI nhiều lần (theo IP + email); đăng nhập đúng không bị tính.
    loginThrottle.assertAllowed(ip, email);

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
    if (!outcome) {
      loginThrottle.recordFailure(ip, email);
      throw new ApiException(401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản đang bị khóa.');
    }
    loginThrottle.recordSuccess(ip, email);

    const tokens = await this.issue(req, res, outcome.id, outcome.name, outcome.fp, newSessionId());
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
    const account = await this.db.read(async (db) => {
      const row = await db.one<{ HoTen: string; TrangThaiTaiKhoan: boolean; MatKhauBam: string }>('SELECT HoTen, TrangThaiTaiKhoan, MatKhauBam FROM dbo.NguoiDung WHERE MaNguoiDung = @id;', { id: payload.sub });
      return row && { ...row, revoked: await isRevoked(db, payload.sid) };
    });
    if (!account || !account.TrangThaiTaiKhoan || account.revoked || fingerprint(account.MatKhauBam) !== payload.fp) {
      clearAuthCookies(res);
      throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');
    }
    const tokens = await this.issue(req, res, payload.sub, account.HoTen, payload.fp, isSessionId(payload.sid) ? payload.sid : newSessionId());
    return this.isMobile(req) ? { ok: true, tokens } : { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null): Promise<void> {
    // Thu hồi phiên của access token; nếu refresh token gửi kèm thuộc phiên khác của chính người này thì thu hồi luôn.
    const sids = new Set<string>();
    if (user.sid) sids.add(user.sid);
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const refreshToken = toStr(body?.refreshToken) || cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      try {
        const p = await this.jwt.verifyAsync<TokenPayload>(refreshToken);
        if (p.typ === 'refresh' && p.sub === user.id && isSessionId(p.sid)) sids.add(p.sid);
      } catch { /* token hết hạn / sai: không cần thu hồi */ }
    }
    await this.db.tx(user.id, async (db) => {
      for (const sid of sids) await revokeSession(db, sid, user.id, appConfig.jwt.refreshTtlSeconds);
      await writeAudit(db, user.id, 'DangXuat', 'NguoiDung', String(user.id), null, null, ip);
    });
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
    const throttleKey = `doi-mat-khau:${user.id}`;
    loginThrottle.assertAllowed(ip, throttleKey);
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
    if (result.status === 400) {
      loginThrottle.recordFailure(ip, throttleKey);
      throw new FieldErrorsException({ currentPassword: 'Mật khẩu hiện tại không đúng.' });
    }
    loginThrottle.recordSuccess(ip, throttleKey);
    const tokens = await this.issue(req, res, user.id, result.name, fingerprint(newHash), user.sid ?? newSessionId());
    if (this.isMobile(req)) {
      res.status(200);
      return { tokens } as unknown as void;
    }
  }

  /** Quên mật khẩu bước 1: gửi mã 6 chữ số về email. Luôn trả cùng một câu, không tiết lộ email nào có tài khoản. */
  @Public()
  @Post('quen-mat-khau')
  @HttpCode(200)
  async forgotPassword(@Body() body: Record<string, unknown>, @ClientIp() ip: string | null): Promise<{ message: string }> {
    const email = (toStr(body?.email) ?? '').trim();
    if (!isValidEmail(email)) throw new FieldErrorsException({ email: 'Nhập email hợp lệ, ví dụ ten@huit.edu.vn.' });
    const key = `gui-ma:${email}`;
    if (resetLimiter.isBlocked(ip, key)) throw new ApiException(429, 'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau 15 phút.');
    resetLimiter.recordFailure(ip, key);
    const issued = await this.db.tx(null, async (db) => {
      if (!(await hasResetTable(db))) return 'missing' as const;
      const user = await db.one<{ MaNguoiDung: number; Email: string; HoTen: string }>('SELECT MaNguoiDung, Email, HoTen FROM dbo.NguoiDung WHERE Email = @email AND TrangThaiTaiKhoan = 1;', { email });
      if (!user) return null;
      const id = user.MaNguoiDung;
      const recent = await db.scalar<number>('SELECT COUNT(*) FROM dbo.MaDatLaiMatKhau WHERE MaNguoiDung = @id AND NgayTao > DATEADD(SECOND, -@wait, SYSUTCDATETIME());', { id, wait: RESET_RESEND_SECONDS });
      if (recent) return null;
      const code = newResetCode();
      await db.exec(
        `UPDATE dbo.MaDatLaiMatKhau SET DaDung = 1 WHERE MaNguoiDung = @id AND DaDung = 0;
         INSERT dbo.MaDatLaiMatKhau (MaNguoiDung, MaBam, HetHan, DiaChiIP) VALUES (@id, @hash, DATEADD(MINUTE, @minutes, SYSUTCDATETIME()), @ip);`,
        { id, hash: hashResetCode(id, code), minutes: RESET_MINUTES, ip: ip?.slice(0, 45) ?? null },
      );
      await writeAudit(db, id, 'GuiMaDatLaiMatKhau', 'NguoiDung', String(id), null, null, ip);
      return { email: user.Email, name: user.HoTen, code };
    });
    if (issued === 'missing') throw new ApiException(503, 'Chức năng quên mật khẩu chưa được bật. Liên hệ quản trị viên khoa.');
    if (issued) await deliverResetCode(issued.email, issued.name, issued.code);
    return { message: `Nếu email có tài khoản đang hoạt động, mã xác thực đã được gửi tới hộp thư. Mã có hiệu lực ${RESET_MINUTES} phút.` };
  }

  /** Quên mật khẩu bước 2: nhập mã + mật khẩu mới. Mọi phiên cũ bị đăng xuất (dấu vân tay mật khẩu đổi). */
  @Public()
  @Post('dat-lai-mat-khau')
  @HttpCode(204)
  async resetPassword(@Body() body: Record<string, unknown>, @ClientIp() ip: string | null): Promise<void> {
    const email = (toStr(body?.email) ?? '').trim();
    const code = (toStr(body?.code) ?? '').trim();
    const next = toStr(body?.newPassword) ?? '';
    const errors: Record<string, string> = {};
    if (!isValidEmail(email)) errors.email = 'Nhập email hợp lệ, ví dụ ten@huit.edu.vn.';
    if (!/^\d{6}$/.test(code)) errors.code = 'Mã xác thực gồm 6 chữ số.';
    const rule = validateNewPassword(next);
    if (rule) errors.newPassword = rule;
    if (Object.keys(errors).length) throw new FieldErrorsException(errors);
    const key = `dat-lai:${email}`;
    if (resetLimiter.isBlocked(ip, key)) throw new ApiException(429, 'Nhập sai mã quá nhiều lần. Vui lòng thử lại sau 15 phút.');

    const newHash = await hashPassword(next);
    const changed = await this.db.tx(null, async (db) => {
      if (!(await hasResetTable(db))) return false;
      const user = await db.one<{ MaNguoiDung: number }>('SELECT MaNguoiDung FROM dbo.NguoiDung WITH (UPDLOCK, HOLDLOCK) WHERE Email = @email AND TrangThaiTaiKhoan = 1;', { email });
      if (!user) return false;
      const id = user.MaNguoiDung;
      const row = await db.one<{ MaYeuCau: number; MaBam: string }>(
        `SELECT TOP 1 MaYeuCau, MaBam FROM dbo.MaDatLaiMatKhau WITH (UPDLOCK, HOLDLOCK)
         WHERE MaNguoiDung = @id AND DaDung = 0 AND HetHan > SYSUTCDATETIME() ORDER BY NgayTao DESC;`, { id });
      if (!row) return false;
      if (!sameHash(row.MaBam, hashResetCode(id, code))) {
        await db.exec(
          `UPDATE dbo.MaDatLaiMatKhau SET SoLanThu = SoLanThu + 1, DaDung = CASE WHEN SoLanThu + 1 >= @max THEN 1 ELSE 0 END
           WHERE MaYeuCau = @requestId;`, { requestId: row.MaYeuCau, max: RESET_MAX_TRIES });
        await writeAudit(db, id, 'DatLaiMatKhauThatBai', 'NguoiDung', String(id), null, null, ip);
        return false;
      }
      await db.exec(
        `UPDATE dbo.NguoiDung SET MatKhauBam = @newHash WHERE MaNguoiDung = @id;
         UPDATE dbo.MaDatLaiMatKhau SET DaDung = 1 WHERE MaNguoiDung = @id AND DaDung = 0;`, { newHash, id });
      await writeAudit(db, id, 'DatLaiMatKhau', 'NguoiDung', String(id), null, null, ip);
      return true;
    });
    if (!changed) {
      resetLimiter.recordFailure(ip, key);
      throw new FieldErrorsException({ code: 'Mã xác thực không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc gửi mã mới.' });
    }
    resetLimiter.recordSuccess(ip, key);
    loginThrottle.recordSuccess(ip, email);
  }
}
