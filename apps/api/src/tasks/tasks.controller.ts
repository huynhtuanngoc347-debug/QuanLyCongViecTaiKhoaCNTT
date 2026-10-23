import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { clampLimit, isTaskScope } from '../common/query-params';
import * as path from 'node:path';
import type { Request, Response } from 'express';
import type {
  AssignOptionsDto, AuditRowDto, CategoryDto, CommentDto, DueAlertDto, HistoryDto, NotificationListDto, PersonalStatsDto,
  TaskDetailDto, TaskListDto, TemplateDto, UnitStatsDto,
} from '@khoa/shared';
import { DbService } from '../db/db.service';
import { ApiException, unwrap } from '../common/result';
import { toInt } from '../common/text';
import { iso } from '../common/vn-time';
import { AuthUser, ClientIp, CurrentUser } from '../auth/auth.guard';
import { loadRights, TaskRights } from './task-access';
import * as Q from './task.queries';
import { TaskCommands } from './task.commands';
import { CatalogService, categories, templates } from './catalog.service';
import { ReminderScheduler, listNotifications, markRead, runDueReminders } from './notifications';
import { runRecurrence } from './catalog.service';
import { personalStats, unitStats } from './stats.queries';
import { MAX_FILES, MAX_FILE_BYTES, UploadedFile, storedName, uploadsRoot } from './task-support';
import { openStored } from './file-store';
import type { FileRow } from './task-policy';

const NOT_VISIBLE = 'Không tìm thấy công việc hoặc bạn không có quyền xem.';
const unauthorized = () => new ApiException(401, 'Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.');

/** Tên tệp tiếng Việt: busboy đọc tên theo latin1, đổi lại UTF-8. */
function fixName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** Định dạng được mở xem trực tiếp trong trình duyệt (?xem=1); còn lại luôn tải về. */
const INLINE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8',
};

const uploadInterceptor = FilesInterceptor('files', MAX_FILES + 1, {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsRoot()),
    filename: (_req, file, cb) => {
      file.originalname = fixName(file.originalname);
      cb(null, storedName(file.originalname));
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES + 1, files: MAX_FILES + 1 },
});

/**
 * API phân hệ Công việc. Mọi endpoint yêu cầu đăng nhập; quyền kiểm tra lại trong CSDL ở từng thao tác.
 *  - Người nhận việc: "Tôi được giao", tiếp nhận, cập nhật tiến độ, nộp kết quả, xin gia hạn, bình luận.
 *  - Người giao việc: tạo, giao, duyệt kết quả, duyệt gia hạn, thống kê đơn vị.
 *  - Quản trị hệ thống: thể loại, mẫu, nhật ký; xem toàn bộ công việc ở chế độ chỉ đọc.
 */
@Controller('api')
export class TasksController {
  constructor(
    private readonly db: DbService,
    private readonly commands: TaskCommands,
    private readonly catalog: CatalogService,
    private readonly scheduler: ReminderScheduler,
  ) {}

  private async withRights<T>(userId: number, work: (db: Parameters<Parameters<DbService['read']>[0]>[0], r: TaskRights) => Promise<T>): Promise<T> {
    return this.db.read(async (db) => {
      const rights = await loadRights(db, userId);
      if (!rights) throw unauthorized();
      return work(db, rights);
    });
  }

  // ----- Danh sách, chi tiết -----
  /** scope=assigned|created|all|review, status=1,2…, categoryId, priority, unitId, overdue, dueSoon, q */
  @Get('cong-viec')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>): Promise<TaskListDto> {
    if (q.scope !== undefined && !isTaskScope(q.scope)) throw new ApiException(400, 'Phạm vi danh sách không hợp lệ.', { scope: 'Chọn assigned, created, all hoặc review.' });
    const query: Q.ListQuery = {
      scope: q.scope ?? null,
      status: (q.status ?? '').split(',').map((x) => toInt(x)).filter((v): v is number => v != null && v >= 0),
      categoryId: toInt(q.categoryId), priority: toInt(q.priority), unitId: toInt(q.unitId),
      overdue: q.overdue === '1' || q.overdue === 'true', dueSoon: q.dueSoon === '1' || q.dueSoon === 'true', search: q.q ?? null,
    };
    return this.withRights(user.id, (db, r) => Q.list(db, r, query));
  }

  /** Người và đơn vị có thể nhận việc (kèm số việc đang mở của từng người). */
  @Get('cong-viec/lua-chon-giao-viec')
  async assignOptions(@CurrentUser() user: AuthUser, @Query('taskId') taskIdText?: string, @Query('assignmentId') assignmentIdText?: string): Promise<AssignOptionsDto> {
    const taskId = toInt(taskIdText), assignmentId = toInt(assignmentIdText);
    const options = await this.withRights<AssignOptionsDto | null>(user.id, async (db, r) => {
      if (assignmentId != null) {
        // Phân công lại: chỉ thành viên của đơn vị nhận.
        const unit = await db.scalar<number>('SELECT MaDonViNhan FROM dbo.PhanCong WHERE MaPhanCong = @aid;', { aid: assignmentId });
        return unit != null && r.directAssignUnits.has(unit) ? Q.assignOptions(db, [unit]) : { people: [], units: [] };
      }
      const scope = new Set(r.assignUnits);
      if (taskId != null) {
        // Công việc không tồn tại hoặc người gọi không được xem → 404 (giống GET cong-viec/:id), không trả danh sách rỗng.
        if (!(await Q.loadVisible(db, r, taskId)).tasks.length) return null;
        const creator = await db.scalar<number>('SELECT MaNguoiTao FROM dbo.CongViec WHERE MaCongViec = @tid;', { tid: taskId });
        if (creator === user.id) r.createUnits.forEach((u) => scope.add(u));
      } else r.createUnits.forEach((u) => scope.add(u));
      return Q.assignOptions(db, [...scope]);
    });
    if (!options) throw new ApiException(404, 'Không tìm thấy công việc hoặc bạn không có quyền xem.');
    return options;
  }

  @Get('cong-viec/:id')
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<TaskDetailDto> {
    const detail = await this.withRights(user.id, (db, r) => Q.detail(db, r, id));
    if (!detail) throw new ApiException(404, NOT_VISIBLE);
    return detail;
  }

  @Get('cong-viec/:id/binh-luan')
  async comments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<CommentDto[]> {
    const result = await this.withRights(user.id, async (db, r) => ((await Q.loadVisible(db, r, id)).tasks.length ? Q.comments(db, id) : null));
    if (!result) throw new ApiException(404, NOT_VISIBLE);
    return result;
  }

  @Get('cong-viec/:id/lich-su')
  async history(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<HistoryDto[]> {
    const result = await this.withRights(user.id, async (db, r) => ((await Q.loadVisible(db, r, id)).tasks.length ? Q.history(db, id) : null));
    if (!result) throw new ApiException(404, NOT_VISIBLE);
    return result;
  }

  // ----- Tạo, sửa, trạng thái -----
  /** Tạo công việc (draft=true để lưu nháp). */
  @Post('cong-viec')
  @HttpCode(201)
  async create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.create(user.id, body ?? {})) };
  }

  @Put('cong-viec/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.update(user.id, id, body ?? {})) };
  }

  /** action = publish | pause | resume | cancel | complete */
  @Post('cong-viec/:id/trang-thai')
  @HttpCode(200)
  async status(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.changeStatus(user.id, id, body ?? {})) };
  }

  /** Giao việc cho cá nhân hoặc cả đơn vị. */
  @Post('cong-viec/:id/phan-cong')
  @HttpCode(200)
  async assign(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ created: number }> {
    return { created: unwrap(await this.commands.assign(user.id, id, body ?? {})) };
  }

  /** Bình luận: JSON { content, parentId, replyToId } hoặc multipart kèm files (≤ 10 tệp × 20 MB). */
  @Post('cong-viec/:id/binh-luan')
  @HttpCode(200)
  @UseInterceptors(uploadInterceptor)
  async comment(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @UploadedFiles() files: UploadedFile[] | undefined, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.comment(user.id, id, (req.body ?? {}) as Record<string, unknown>, files ?? [])) };
  }

  // ----- Phân công -----
  @Post('phan-cong/:id/tiep-nhan')
  @HttpCode(200)
  async accept(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.accept(user.id, id)) };
  }

  @Post('phan-cong/:id/tu-choi')
  @HttpCode(200)
  async reject(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.reject(user.id, id, body ?? {})) };
  }

  /** Trưởng đơn vị nhận việc tiếp nhận và giao lại cho thành viên. */
  @Post('phan-cong/:id/phan-cong-lai')
  @HttpCode(200)
  async delegate(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ created: number }> {
    return { created: unwrap(await this.commands.delegate(user.id, id, body ?? {})) };
  }

  @Post('phan-cong/:id/tien-do')
  @HttpCode(200)
  async progress(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.progress(user.id, id, body ?? {})) };
  }

  /** Nộp kết quả (multipart/form-data: content, link, files ≤ 10 tệp × 20 MB). */
  @Post('phan-cong/:id/ket-qua')
  @HttpCode(200)
  @UseInterceptors(uploadInterceptor)
  async submit(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @UploadedFiles() files: UploadedFile[] | undefined, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return { id: unwrap(await this.commands.submit(user.id, id, body.content, body.link, files ?? [])) };
  }

  @Post('phan-cong/:id/gia-han')
  @HttpCode(200)
  async requestExtension(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.requestExtension(user.id, id, body ?? {})) };
  }

  @Post('phan-cong/:id/huy')
  @HttpCode(200)
  async cancelAssignment(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.cancelAssignment(user.id, id, body ?? {})) };
  }

  @Post('phan-cong/:id/nhac')
  @HttpCode(200)
  async remind(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<{ notified: number }> {
    return { notified: unwrap(await this.commands.remind(user.id, id)) };
  }

  /** Đánh giá lần nộp mới nhất: 1 Đạt, 2 Cần bổ sung, 3 Không đạt. */
  @Post('ket-qua/:id/danh-gia')
  @HttpCode(200)
  async evaluate(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.evaluate(user.id, id, body ?? {})) };
  }

  /** decision = approve | approve-other | reject */
  @Post('gia-han/:id/duyet')
  @HttpCode(200)
  async decide(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.decideExtension(user.id, id, body ?? {})) };
  }

  /** Xin từ chối việc đã tiếp nhận (body: reason). */
  @Post('phan-cong/:id/xin-tu-choi')
  @HttpCode(200)
  async requestDecline(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.requestDecline(user.id, id, body ?? {})) };
  }

  /** decision = approve | reject (reject bắt buộc comment). */
  @Post('xin-tu-choi/:id/duyet')
  @HttpCode(200)
  async decideDecline(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    return { id: unwrap(await this.commands.decideDecline(user.id, id, body ?? {})) };
  }

  // ----- Tệp đính kèm -----
  /** Đính kèm tệp cho công việc (multipart, trường "files"); người quản lý công việc. */
  @Post('cong-viec/:id/tep')
  @UseInterceptors(uploadInterceptor)
  async addTaskFiles(@Param('id', ParseIntPipe) id: number, @UploadedFiles() files: UploadedFile[] | undefined, @CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return { count: unwrap(await this.commands.addTaskFiles(user.id, id, files ?? [])) };
  }

  /** Gỡ tệp đính kèm của công việc (không áp dụng cho tệp kết quả, bình luận). */
  @Delete('tep/:id')
  @HttpCode(204)
  async removeTaskFile(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<void> {
    unwrap(await this.commands.removeTaskFile(user.id, id));
  }

  /** Tải tệp đính kèm (kiểm tra quyền xem công việc). ?xem=1: mở xem trực tiếp với PDF, ảnh, TXT; định dạng khác vẫn tải về. */
  @Get('tep/:id')
  async file(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response, @Query('xem') view?: string): Promise<void> {
    const file = await this.withRights(user.id, async (db, r) => {
      const row = await db.one<FileRow>(
        `SELECT f.MaTep, COALESCE(f.MaCongViec, pk.MaCongViec, b.MaCongViec) AS MaCongViec, f.MaKetQua, f.MaBinhLuan,
                f.MaNguoiTaiLen, f.TenTep, f.DuongDan, f.LoaiTep, f.KichThuoc, f.NgayTaiLen
         FROM dbo.TepDinhKem AS f
         LEFT JOIN dbo.KetQuaCongViec AS k ON k.MaKetQua = f.MaKetQua
         LEFT JOIN dbo.PhanCong AS pk ON pk.MaPhanCong = k.MaPhanCong
         LEFT JOIN dbo.BinhLuan AS b ON b.MaBinhLuan = f.MaBinhLuan
         WHERE f.MaTep = @id;`,
        { id },
      );
      if (!row || row.MaCongViec == null) return null;
      return (await Q.loadVisible(db, r, row.MaCongViec)).tasks.length ? row : null;
    });
    if (!file) throw new ApiException(404, 'Không tìm thấy tệp hoặc bạn không có quyền tải.');
    const content = await openStored(file.DuongDan);
    if (!content) throw new ApiException(404, 'Tệp này chỉ có thông tin mô tả (dữ liệu mẫu), không có nội dung để tải.');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Tệp trên kho ngoài: chuyển tiếp luồng; ngắt kết nối nếu kho lỗi giữa chừng
    const send = () => {
      if ('local' in content) return res.sendFile(content.local);
      if (content.size != null) res.setHeader('Content-Length', content.size);
      content.stream.on('error', () => res.destroy()).pipe(res);
    };
    // Xem trực tiếp chỉ cho định dạng an toàn; kiểu nội dung lấy theo đuôi tệp (không tin LoaiTep do trình duyệt gửi).
    const inline = INLINE_TYPES[path.extname(file.TenTep).toLowerCase()];
    if (view === '1' && inline) {
      res.setHeader('Content-Type', inline);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.TenTep)}`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      send();
      return;
    }
    res.attachment(file.TenTep);
    res.setHeader('Content-Type', file.LoaiTep && file.LoaiTep.trim() ? file.LoaiTep : 'application/octet-stream');
    send();
  }

  // ----- Thể loại, mẫu -----
  @Get('the-loai')
  categories(): Promise<CategoryDto[]> {
    return this.db.read(categories);
  }

  @Post('the-loai')
  @HttpCode(200)
  async addCategory(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<CategoryDto> {
    return unwrap(await this.catalog.saveCategory(user.id, null, body ?? {}, ip));
  }

  @Put('the-loai/:id')
  async saveCategory(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<CategoryDto> {
    return unwrap(await this.catalog.saveCategory(user.id, id, body ?? {}, ip));
  }

  @Get('mau-cong-viec')
  templates(@CurrentUser() user: AuthUser): Promise<TemplateDto[]> {
    return this.withRights(user.id, (db, r) => templates(db, r));
  }

  @Post('mau-cong-viec')
  @HttpCode(200)
  async addTemplate(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<TemplateDto> {
    return unwrap(await this.catalog.saveTemplate(user.id, null, body ?? {}));
  }

  @Put('mau-cong-viec/:id')
  async saveTemplate(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<TemplateDto> {
    return unwrap(await this.catalog.saveTemplate(user.id, id, body ?? {}));
  }

  /** Xóa mẫu; công việc đã tạo từ mẫu được giữ, chỉ bỏ liên kết. */
  @Delete('mau-cong-viec/:id')
  async deleteTemplate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<{ unlinkedTasks: number }> {
    return unwrap(await this.catalog.deleteTemplate(user.id, id, ip));
  }

  // ----- Thông báo, cảnh báo hạn -----
  @Get('thong-bao')
  notifications(@CurrentUser() user: AuthUser, @Query('unread') unread?: string, @Query('limit') limit?: string): Promise<NotificationListDto> {
    return this.db.read((db) => listNotifications(db, user.id, unread === 'true' || unread === '1', toInt(limit) ?? 30));
  }

  @Post('thong-bao/da-doc-tat-ca')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return { updated: await markRead(this.db, user.id, null) };
  }

  @Post('thong-bao/:id/da-doc')
  @HttpCode(200)
  async read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return { updated: await markRead(this.db, user.id, id) };
  }

  /** Việc quá hạn / còn ≤ 3 ngày của người đăng nhập (pop-up sau đăng nhập). */
  @Get('canh-bao-han')
  dueAlert(@CurrentUser() user: AuthUser): Promise<DueAlertDto> {
    return this.withRights(user.id, (db, r) => Q.dueAlert(db, r));
  }

  // ----- Thống kê -----
  /** Thống kê đơn vị trong phạm vi quyền (from, to: yyyy-MM-dd). */
  @Get('thong-ke/don-vi')
  async unitStats(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>): Promise<UnitStatsDto> {
    return unwrap(await this.withRights(user.id, (db, r) => unitStats(db, r, q.from ?? null, q.to ?? null, toInt(q.unitId), toInt(q.categoryId))));
  }

  /** Thống kê của tôi, hoặc của một người trong đơn vị mình quản lý (personId). */
  @Get('thong-ke/ca-nhan')
  async personalStats(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>): Promise<PersonalStatsDto> {
    return unwrap(await this.withRights(user.id, (db, r) => personalStats(db, r, toInt(q.personId) ?? user.id, q.from ?? null, q.to ?? null)));
  }

  // ----- Quản trị -----
  /** Nhật ký hệ thống (chỉ quản trị; không chứa mật khẩu). */
  @Get('nhat-ky')
  async audit(@CurrentUser() user: AuthUser, @Query('limit') limitText?: string, @Query('q') search?: string): Promise<AuditRowDto[]> {
    const rows = await this.db.read(async (db) => {
      const admin = await db.scalar<boolean>('SELECT LaQuanTriHeThong FROM dbo.NguoiDung WHERE MaNguoiDung = @userId AND TrangThaiTaiKhoan = 1;', { userId: user.id });
      if (admin !== true) return null;
      const limit = clampLimit(limitText, 200, 1000);
      const q = search && search.trim() ? search.trim() : null;
      return db.query<{ id: number; action: string; objectType: string; objectId: string; actor: string; ip: string; at: Date }>(
        `SELECT TOP (@limit) nk.MaNhatKy AS id, nk.HanhDong AS action, ISNULL(nk.LoaiDoiTuong, N'') AS objectType,
                ISNULL(nk.DinhDanhDoiTuong, N'') AS objectId, ISNULL(n.HoTen, N'Hệ thống') AS actor,
                ISNULL(nk.DiaChiIP, '') AS ip, nk.ThoiGian AS at
         FROM dbo.NhatKyHeThong AS nk LEFT JOIN dbo.NguoiDung AS n ON n.MaNguoiDung = nk.MaNguoiThaoTac
         WHERE @q IS NULL OR nk.HanhDong LIKE N'%' + @q + N'%' OR n.HoTen LIKE N'%' + @q + N'%' OR nk.LoaiDoiTuong LIKE N'%' + @q + N'%'
         ORDER BY nk.ThoiGian DESC, nk.MaNhatKy DESC;`,
        { limit, q },
      );
    });
    if (!rows) throw new ApiException(403, 'Chỉ quản trị hệ thống xem được nhật ký.');
    return rows.map((x) => ({ ...x, at: iso(x.at)! }));
  }

  /** Chạy ngay tác vụ nhắc hạn và lặp lại (thường tự chạy mỗi giờ). */
  @Post('he-thong/chay-nhac-han')
  @HttpCode(200)
  async runReminders(@CurrentUser() user: AuthUser): Promise<{ reminders: number; drafts: number }> {
    const admin = await this.db.read((db) => db.scalar<boolean>('SELECT LaQuanTriHeThong FROM dbo.NguoiDung WHERE MaNguoiDung = @userId AND TrangThaiTaiKhoan = 1;', { userId: user.id }));
    if (admin !== true) throw new ApiException(403, 'Chỉ quản trị hệ thống chạy được tác vụ này.');
    void this.scheduler;
    return { reminders: await runDueReminders(this.db), drafts: await runRecurrence(this.db) };
  }
}
