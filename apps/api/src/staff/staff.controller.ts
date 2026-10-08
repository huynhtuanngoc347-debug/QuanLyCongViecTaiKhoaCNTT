import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import type { CreatedPersonDto, PasswordResetDto, PersonDto, PortalDto } from '@khoa/shared';
import { DbService } from '../db/db.service';
import { ApiException, unwrap } from '../common/result';
import { AuthUser, ClientIp, CurrentUser } from '../auth/auth.guard';
import { PORTAL_KEYS, loadActiveUser, portals } from '../auth/access.service';
import { StaffCommands } from './staff.commands';

/** Quản lý tài khoản nhân sự (chỉ quản trị hệ thống; kiểm tra lại trong CSDL ở mỗi thao tác). */
@Controller('api/nhan-su')
export class StaffController {
  constructor(private readonly commands: StaffCommands) {}

  /** Thêm nhân sự; trả mật khẩu tạm một lần. */
  @Post()
  @HttpCode(201)
  async create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<CreatedPersonDto> {
    return unwrap(await this.commands.create(user.id, body ?? {}, ip));
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<PersonDto> {
    return unwrap(await this.commands.update(user.id, id, body ?? {}, ip));
  }

  /** Cấp lại mật khẩu tạm; đăng xuất mọi phiên của người đó. */
  @Post(':id/cap-lai-mat-khau')
  @HttpCode(200)
  async resetPassword(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<PasswordResetDto> {
    return unwrap(await this.commands.resetPassword(user.id, id, ip));
  }

  /** Khóa / mở khóa tài khoản ({ active: false }). */
  @Put(':id/trang-thai')
  async setStatus(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<PersonDto> {
    return unwrap(await this.commands.setStatus(user.id, id, body ?? {}, ip));
  }

  /** Xóa tài khoản chưa phát sinh lịch sử (409 nếu đã có lịch sử). */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<void> {
    unwrap(await this.commands.remove(user.id, id, ip));
  }
}

/**
 * Trang theo vai trò. Máy chủ quyết định ai được vào trang nào:
 * GET /api/trang/admin của người không phải quản trị trả 403.
 */
@Controller('api/trang')
export class PortalController {
  constructor(private readonly db: DbService) {}

  @Get(':key')
  async portal(@Param('key') key: string, @CurrentUser() user: AuthUser): Promise<PortalDto> {
    const list = await this.db.read(async (db) => {
      const person = await loadActiveUser(db, user.id);
      return person ? portals(db, person) : null;
    });
    if (!list) throw new ApiException(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');
    const found = list.find((p) => p.key === key);
    if (found) return found;
    throw (PORTAL_KEYS as readonly string[]).includes(key)
      ? new ApiException(403, 'Tài khoản của bạn không có vai trò để vào trang này.')
      : new ApiException(404, 'Không có trang này.');
  }
}
