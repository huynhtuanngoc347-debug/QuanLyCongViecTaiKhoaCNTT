/**
 * Kiểu dữ liệu (DTO) dùng chung giữa API NestJS, web React và app React Native.
 * Tên thuộc tính giữ đúng như bản ASP.NET Core (camelCase) để giao diện không phải đổi.
 * Ngày giờ: chuỗi ISO UTC (có "Z"); ngày thuần: "yyyy-MM-dd".
 *
 * Quy ước số (theo KhoaCNTT_chinhlan1.sql):
 *   TaskStatus        0 Nháp, 1 Chưa bắt đầu, 2 Đang thực hiện, 3 Chờ duyệt, 4 Hoàn thành, 5 Tạm dừng, 6 Đã hủy
 *   AssignmentStatus  0 Chờ tiếp nhận, 1 Đã tiếp nhận, 2 Đang thực hiện, 3 Chờ duyệt, 4 Hoàn thành, 5 Từ chối, 6 Đã hủy
 *   ResultStatus      0 Chờ duyệt, 1 Đạt, 2 Cần bổ sung, 3 Không đạt
 *   ExtensionStatus   0 Chờ duyệt, 1 Đồng ý, 2 Đồng ý hạn khác, 3 Từ chối
 */

export type IsoDateTime = string;
export type IsoDate = string;

// ===================== LỖI =====================
export interface ApiErrorBody {
  message: string;
  errors?: Record<string, string>;
}

// ===================== TỔ CHỨC =====================
export interface UnitDto { id: number; code: string; name: string; type: string; parentId: number | null; active: boolean; description: string; }
export interface PersonDto {
  id: number; employeeCode: string; name: string; initials: string; email: string; degree: string;
  academicTitle: string; training: string; phone: string; active: boolean; isSystemAdmin: boolean;
}
export type PermissionKey = 'createTask' | 'assignTask' | 'approveResult' | 'evaluateResult' | 'viewReport' | 'manageMembers' | 'includeChildren';
export interface RoleDto { id: number; name: string; description: string; active: boolean; permissions: Record<PermissionKey, boolean>; }
export interface MembershipDto { personId: number; unitId: number; roleId: number; primary: boolean; start: IsoDate; end: IsoDate | ''; }
export interface OrganizationDto { units: UnitDto[]; people: PersonDto[]; roles: RoleDto[]; memberships: MembershipDto[]; }
export interface ProfileDto { person: PersonDto; memberships: MembershipDto[]; }

export interface CurrentUserDto { id: number; name: string; initials: string; email: string; isSystemAdmin: boolean; roleSummary: string; }
export interface CapabilitiesDto { canCreateUnit: boolean; canEditRoles: boolean; manageableUnitIds: number[]; }
export type PortalKey = 'admin' | 'truong-khoa' | 'truong-bo-mon' | 'ca-nhan';
export interface PortalDto { key: PortalKey; roleLabel: string; title: string; scope: string; }
export interface TaskCapabilitiesDto { createUnitIds: number[]; assignUnitIds: number[]; reviewUnitIds: number[]; reportUnitIds: number[]; isMember: boolean; }
export interface SessionDto { user: CurrentUserDto; capabilities: CapabilitiesDto; portals: PortalDto[]; tasks: TaskCapabilitiesDto; }

/** Đăng nhập từ app di động (header X-Client: mobile): kèm token để gửi bằng Authorization: Bearer. */
export interface TokenPairDto { accessToken: string; refreshToken: string; accessExpiresIn: number; }
export interface LoginResponseDto extends SessionDto { tokens?: TokenPairDto; }

export interface LoginRequest { email: string; password: string; }
export interface ChangePasswordRequest { currentPassword: string; newPassword: string; }
export interface NewParentRequest { name: string; type: string; parentMode: 'existing' | 'none'; parentId: number | null; }
export interface CreateUnitRequest {
  name: string; type: string; parentMode: 'existing' | 'none' | 'new'; parentId: number | null;
  newParent: NewParentRequest | null; description: string; active: boolean;
}
export interface CreatedUnitDto { unit: UnitDto; createdParent: UnitDto | null; }
export interface CreateMembershipRequest { personId: number; unitId: number; roleId: number; start: IsoDate; end: IsoDate | ''; primary: boolean; }
export interface PersonRequest {
  name: string; email: string; academicTitle: string; degree: string; training: string; phone: string;
  isSystemAdmin: boolean; active?: boolean;
}
export interface CreatedPersonDto { person: PersonDto; temporaryPassword: string; }
export interface PasswordResetDto { personId: number; temporaryPassword: string; }

// ===================== CÔNG VIỆC =====================
export type TaskStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type AssignmentStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ResultStatus = 0 | 1 | 2 | 3;
export type ExtensionStatus = 0 | 1 | 2 | 3;
export type Priority = 1 | 2 | 3 | 4;
/** 1 Chủ trì, 2 Phối hợp */
export type AssignmentRole = 1 | 2;

export interface TaskPersonRef { id: number; name: string; initials: string; }
export interface AssigneeRef { kind: 'person' | 'unit'; id: number; name: string; initials: string; status: number; }

export interface TaskSummaryDto {
  id: number; title: string; status: number; priority: number; progress: number;
  start: IsoDateTime | null; due: IsoDateTime | null; createdAt: IsoDateTime; completedAt: IsoDateTime | null;
  unitId: number; unitName: string; categoryId: number | null; categoryName: string;
  creatorId: number; creatorName: string; parentId: number | null;
  overdue: boolean; dueSoon: boolean; assignees: AssigneeRef[];
  assignedToMe: boolean; createdOrAssignedByMe: boolean; pendingReviews: number;
  myAssignmentId: number | null; myAssignmentStatus: number | null; myProgress: number | null; myDue: IsoDateTime | null;
  /** Vai trò của tôi trong phân công (1 Chủ trì, 2 Phối hợp) — bổ sung ở bản NestJS. */
  myRole: number | null;
}
export type TaskScope = 'assigned' | 'created' | 'all' | 'review';
export interface TaskListDto { items: TaskSummaryDto[]; counts: Record<'assigned' | 'created' | 'all' | 'review' | 'overdue', number>; }

export interface ProgressEntryDto { id: number; percent: number; note: string; at: IsoDateTime; by: TaskPersonRef; }
export interface FileDto { id: number; name: string; size: number; contentType: string | null; uploadedAt: IsoDateTime; downloadable: boolean; }
export interface ReviewDto { decision: number; comment: string; reviewer: TaskPersonRef; at: IsoDateTime; }
export interface ResultDto {
  id: number; attempt: number; content: string; status: number; submittedAt: IsoDateTime;
  submitter: TaskPersonRef; files: FileDto[]; review: ReviewDto | null;
}
export interface ExtensionDto {
  id: number; oldDue: IsoDateTime; proposedDue: IsoDateTime; reason: string; status: number;
  approvedDue: IsoDateTime | null; comment: string; requestedBy: TaskPersonRef; decidedBy: TaskPersonRef | null;
  createdAt: IsoDateTime; decidedAt: IsoDateTime | null;
}
/** Xin từ chối sau khi đã tiếp nhận. status: 0 Chờ duyệt, 1 Đồng ý, 2 Không đồng ý. */
export interface DeclineDto {
  id: number; reason: string; status: number; comment: string; requestedBy: TaskPersonRef; decidedBy: TaskPersonRef | null;
  createdAt: IsoDateTime; decidedAt: IsoDateTime | null;
}
export interface AssignmentActionsDto {
  canAccept: boolean; canReject: boolean; canDelegate: boolean; canUpdateProgress: boolean; canSubmit: boolean;
  canEvaluate: boolean; canRequestExtension: boolean; canDecideExtension: boolean; canCancel: boolean; canRemind: boolean;
  canRequestDecline: boolean; canDecideDecline: boolean;
}
export interface AssignmentDto {
  id: number; kind: 'person' | 'unit'; personId: number | null; unitId: number | null; name: string; initials: string;
  subtitle: string; role: number | null; status: number; note: string; assigner: TaskPersonRef; assignerUnitId: number | null;
  assignedAt: IsoDateTime; due: IsoDateTime; acceptedAt: IsoDateTime | null; completedAt: IsoDateTime | null;
  progress: number; overdue: boolean; dueSoon: boolean; progressHistory: ProgressEntryDto[]; results: ResultDto[];
  extensions: ExtensionDto[]; approvedExtensions: number; declines: DeclineDto[]; actions: AssignmentActionsDto;
}
export interface TaskLinkDto { id: number; title: string; status: number; }
export interface TaskPermissionsDto {
  canEdit: boolean; canAssign: boolean; canPause: boolean; canResume: boolean; canCancel: boolean;
  canComplete: boolean; canPublish: boolean; canComment: boolean; readOnly: boolean;
}
export interface TaskDetailDto {
  summary: TaskSummaryDto; description: string; criteria: string; templateId: number | null;
  parent: TaskLinkDto | null; children: TaskLinkDto[]; dependsOn: TaskLinkDto[]; files: FileDto[];
  assignments: AssignmentDto[]; pendingExtensions: number; permissions: TaskPermissionsDto;
}
export interface CommentDto { id: number; parentId: number | null; content: string; author: TaskPersonRef; createdAt: IsoDateTime; updatedAt: IsoDateTime | null; files: FileDto[]; }
export interface HistoryDto { id: number; type: string; description: string; field: string | null; oldValue: string | null; newValue: string | null; by: TaskPersonRef | null; at: IsoDateTime; }
export interface CategoryDto { id: number; name: string; description: string; active: boolean; taskCount: number; }
export interface CandidatePersonDto { id: number; name: string; initials: string; unitName: string; openTasks: number; }
export interface CandidateUnitDto { id: number; name: string; type: string; }
export interface AssignOptionsDto { people: CandidatePersonDto[]; units: CandidateUnitDto[]; }
export interface TemplateDto {
  id: number; name: string; title: string; description: string; criteria: string; categoryId: number | null; categoryName: string;
  priority: number; unitId: number; unitName: string; durationDays: number; recurrence: number; nextRun: IsoDate | null;
  timesUsed: number; active: boolean; creator: TaskPersonRef; canEdit: boolean;
}
export interface NotificationDto { id: number; type: string; level: number; title: string; content: string; taskId: number | null; read: boolean; needsAction: boolean; createdAt: IsoDateTime; }
export interface NotificationListDto { items: NotificationDto[]; unread: number; }
export interface DueAlertItemDto { taskId: number; assignmentId: number | null; title: string; unitName: string; due: IsoDateTime; progress: number; overdue: boolean; relation: 'assignee' | 'manager'; }
export interface DueAlertDto { overdue: DueAlertItemDto[]; dueSoon: DueAlertItemDto[]; }
export interface AuditRowDto { id: number; action: string; objectType: string; objectId: string; actor: string; ip: string; at: IsoDateTime; }

// ----- Thống kê -----
export interface CountItemDto { key: string; label: string; value: number; }
export interface MonthItemDto { month: string; assigned: number; completed: number; }
export interface UnitStatDto { unitId: number; unitName: string; total: number; open: number; completed: number; overdue: number; onTimePercent: number; }
export interface PersonStatDto { personId: number; name: string; initials: string; unitName: string; assigned: number; completed: number; onTimePercent: number; overdue: number; passed: number; }
export interface UnitStatsDto {
  from: IsoDate; to: IsoDate; scopeLabel: string; total: number; open: number; completed: number; onTimePercent: number; onTimeCount: number;
  overdue: number; passed: number; needsWork: number; failed: number; byStatus: CountItemDto[]; byMonth: MonthItemDto[];
  byUnit: UnitStatDto[]; byPerson: PersonStatDto[];
}
export interface MembershipStatDto { unitId: number; unitName: string; unitType: string; role: string; start: IsoDate; end: IsoDate | null; primary: boolean; ended: boolean; openTasks: number; }
export interface PendingItemDto { kind: 'result' | 'extension' | 'accept'; taskId: number; title: string; who: string; since: IsoDateTime; waitingDays: number; }
export interface AssignerStatsDto { assigned: number; pendingTotal: number; pendingResults: number; pendingExtensions: number; pendingAccept: number; averageReviewDays: number | null; late: number; pending: PendingItemDto[]; }
export interface PersonalStatsDto {
  from: IsoDate; to: IsoDate; person: TaskPersonRef; subtitle: string;
  assigned: number; lead: number; support: number; completed: number; onTimePercent: number; onTimeCount: number;
  open: number; dueSoon: number; waitingReview: number; passed: number; needsWork: number; extensions: number;
  unitAverageOnTime: number | null; byMonth: MonthItemDto[]; byCategory: CountItemDto[]; asAssigner: AssignerStatsDto | null;
  memberships: MembershipStatDto[];
  /** Bổ sung ở bản NestJS cho thẻ "Kết quả của tôi". */
  overdue: number; failed: number; approvedExtensions: number; unitName: string | null;
}

// ----- Yêu cầu -----
export interface TaskRequest {
  title: string; description?: string; criteria?: string; categoryId: number | null; priority: number;
  start: IsoDate | null; due: IsoDate | null; unitId: number | null; parentId: number | null; dependsOn: number[];
  draft: boolean; templateId?: number | null; recurrence?: number; saveAsTemplate?: boolean;
}
export type TaskStatusAction = 'publish' | 'pause' | 'resume' | 'cancel' | 'complete';
export interface AssignRequest { kind: 'person' | 'unit'; personIds: number[]; unitId: number | null; role: number | null; due: IsoDate | null; note: string; }
export interface DelegateRequest { members: { personId: number; role: number | null; due: IsoDate | null }[]; note: string; }
export interface ProgressRequest { percent: number; note: string; }
export interface EvaluateRequest { decision: 1 | 2 | 3; comment: string; }
export interface ExtensionRequest { proposedDue: IsoDate; reason: string; }
export interface ExtensionDecisionRequest { decision: 'approve' | 'approve-other' | 'reject'; approvedDue: IsoDate | null; comment: string; }
export interface CommentRequest { content: string; parentId: number | null; }
export interface CategoryRequest { name: string; description: string; active: boolean; }
export interface TemplateRequest {
  name: string; title: string; description: string; criteria: string; categoryId: number | null; priority: number;
  unitId: number | null; durationDays: number; recurrence: number; nextRun: IsoDate | null; active: boolean;
}
