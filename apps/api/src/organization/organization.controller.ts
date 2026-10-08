import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import type { CreatedUnitDto, MembershipDto, OrganizationDto, PersonDto, ProfileDto, RoleDto, UnitDto } from '@khoa/shared';
import { DbService } from '../db/db.service';
import { ApiException, unwrap } from '../common/result';
import { toInt } from '../common/text';
import { AuthUser, ClientIp, CurrentUser } from '../auth/auth.guard';
import { OrganizationCommands } from './organization.commands';
import * as q from './organization.queries';

/**
 * API cho các màn hình: Cơ cấu tổ chức, Nhân sự, Chức vụ và quyền, Thêm thành viên, Thêm đơn vị, Hồ sơ nhân sự.
 * Mọi endpoint yêu cầu đăng nhập; thao tác ghi kiểm tra quyền lại trong CSDL.
 */
@Controller('api')
export class OrganizationController {
  constructor(private readonly db: DbService, private readonly commands: OrganizationCommands) {}

  /** Toàn bộ dữ liệu tổ chức cho giao diện (units, people, roles, memberships). */
  @Get('to-chuc')
  all(): Promise<OrganizationDto> {
    return this.db.read(q.loadAll);
  }

  @Get('don-vi')
  units(): Promise<UnitDto[]> {
    return this.db.read(q.units);
  }

  @Get('don-vi/:id')
  async unit(@Param('id', ParseIntPipe) id: number): Promise<UnitDto> {
    const unit = await this.db.read((db) => q.unit(db, id));
    if (!unit) throw new ApiException(404, 'Không tìm thấy đơn vị.');
    return unit;
  }

  @Get('don-vi/:id/thanh-vien')
  async members(@Param('id', ParseIntPipe) id: number): Promise<MembershipDto[]> {
    const unit = await this.db.read((db) => q.unit(db, id));
    if (!unit) throw new ApiException(404, 'Không tìm thấy đơn vị.');
    return this.db.read((db) => q.currentMembers(db, id));
  }

  /** Thêm đơn vị; mã do SQL cấp; có thể tạo đơn vị cha mới cùng lúc (quản trị hệ thống). */
  @Post('don-vi')
  @HttpCode(201)
  async createUnit(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<CreatedUnitDto> {
    return unwrap(await this.commands.createUnit(user.id, body ?? {}, ip));
  }

  @Get('nhan-su')
  people(@Query('q') search?: string, @Query('donVi') donVi?: string, @Query('trangThai') status?: string): Promise<PersonDto[]> {
    return this.db.read((db) => q.people(db, search ?? null, toInt(donVi), status ?? null));
  }

  @Get('nhan-su/:id')
  async profile(@Param('id', ParseIntPipe) id: number): Promise<ProfileDto> {
    const profile = await this.db.read((db) => q.profile(db, id));
    if (!profile) throw new ApiException(404, 'Không tìm thấy hồ sơ.');
    return profile;
  }

  @Get('chuc-vu')
  roles(): Promise<RoleDto[]> {
    return this.db.read(q.roles);
  }

  /** Lưu quyền nghiệp vụ của chức vụ (quản trị hệ thống). */
  @Put('chuc-vu/:id/quyen')
  async savePermissions(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<RoleDto> {
    return unwrap(await this.commands.saveRolePermissions(user.id, id, body, ip));
  }

  /** Thêm thành viên / tái bổ nhiệm cùng bộ ba đã kết thúc. */
  @Post('thanh-vien')
  @HttpCode(201)
  async createMembership(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<MembershipDto> {
    return unwrap(await this.commands.createMembership(user.id, body ?? {}, ip));
  }
}
