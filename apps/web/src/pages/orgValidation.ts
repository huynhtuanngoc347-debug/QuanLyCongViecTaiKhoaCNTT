import type { OrganizationDto } from '@khoa/shared';
import { validDate } from '../format';

/** Kiểm tra ở trình duyệt chỉ để báo lỗi sớm; máy chủ kiểm tra lại toàn bộ (giống js/store.js). */
export const NO_PARENT = '__none', NEW_PARENT = '__new';
const clean = (v: unknown) => String(v ?? '').trim();
const collapse = (v: unknown) => clean(v).replace(/\s+/g, ' ');
const sameName = (a: string, b: string) => collapse(a).toLocaleLowerCase('vi') === collapse(b).toLocaleLowerCase('vi');
const asBool = (v: unknown) => v === true || v === 'true';
const isBool = (v: unknown) => ['true', 'false', true, false].includes(v as never);
type V = Record<string, string>;

function unitFieldErrors(errors: V, name: string, type: string, prefix: string, subject: string) {
  const nameKey = prefix ? prefix + 'Name' : 'name', typeKey = prefix ? prefix + 'Type' : 'type';
  const n = collapse(name), t = collapse(type);
  if (!n) errors[nameKey] = `Chưa nhập tên ${subject}.`;
  else if (n.length < 2) errors[nameKey] = `Tên ${subject} quá ngắn: cần ít nhất 2 ký tự.`;
  else if (n.length > 150) errors[nameKey] = `Tên ${subject} dài ${n.length} ký tự; tối đa 150 ký tự.`;
  if (!t) errors[typeKey] = `Chưa chọn hoặc nhập loại ${subject} (ví dụ Bộ môn, Nhóm, Trung tâm).`;
  else if (t.length > 30) errors[typeKey] = `Loại ${subject} dài ${t.length} ký tự; tối đa 30 ký tự.`;
  else if (!/\p{L}/u.test(t)) errors[typeKey] = `Loại ${subject} phải có chữ, ví dụ “Trung tâm”.`;
}

function parentError(data: OrganizationDto, value: string, whose: string): string {
  if (!value) return `Chưa chọn đơn vị cha cho ${whose}. Chọn một đơn vị, “Đơn vị gốc” hoặc “Tạo đơn vị cha mới”.`;
  const parent = data.units.find((u) => u.id === Number(value));
  if (!parent) return `Đơn vị cha mã ${value} không còn tồn tại. Tải lại trang rồi chọn lại.`;
  if (!parent.active) return `Đơn vị cha “${parent.name}” đang ngừng hoạt động. Chọn đơn vị khác hoặc kích hoạt lại “${parent.name}” trước.`;
  return '';
}

function siblingError(data: OrganizationDto, parentId: number | null, name: string): string {
  const twin = data.units.find((u) => (u.parentId ?? null) === parentId && sameName(u.name, name));
  if (!twin) return '';
  if (parentId === null) return `Đã có đơn vị gốc tên “${twin.name}” (mã ${twin.id}). Đặt tên khác hoặc chọn đơn vị cha.`;
  const parent = data.units.find((u) => u.id === parentId);
  return `“${parent?.name || 'Đơn vị cha'}” đã có đơn vị con tên “${twin.name}” (mã ${twin.id}). Đặt tên khác.`;
}

export function unitErrors(data: OrganizationDto, input: V): V {
  const errors: V = {};
  unitFieldErrors(errors, input.name, input.type, '', 'đơn vị');
  const description = clean(input.description);
  if (description.length > 1000) errors.description = `Mô tả dài ${description.length} ký tự; tối đa 1.000 ký tự.`;
  if (!isBool(input.active)) errors.active = 'Chọn trạng thái: Đang hoạt động hoặc Ngừng hoạt động.';
  const mode = input.parentId === NO_PARENT ? 'none' : input.parentId === NEW_PARENT ? 'new' : 'existing';
  if (mode === 'existing') {
    const e = parentError(data, input.parentId, 'đơn vị mới');
    if (e) errors.parentId = e;
    else if (!errors.name) { const d = siblingError(data, Number(input.parentId), input.name); if (d) errors.name = d; }
  } else if (mode === 'none') {
    if (!errors.name) { const d = siblingError(data, null, input.name); if (d) errors.name = d; }
  } else {
    unitFieldErrors(errors, input.newParentName, input.newParentType, 'newParent', 'đơn vị cha mới');
    let grandId: number | null = null;
    if (input.newParentParentId !== NO_PARENT) {
      const e = parentError(data, input.newParentParentId, 'đơn vị cha mới');
      if (e) errors.newParentParentId = e; else grandId = Number(input.newParentParentId);
    }
    if (!errors.newParentName && !errors.newParentParentId) { const d = siblingError(data, grandId, input.newParentName); if (d) errors.newParentName = d; }
    if (!errors.name && !errors.newParentName && sameName(input.name, input.newParentName)) errors.name = 'Tên đơn vị trùng tên đơn vị cha mới. Đặt tên khác để dễ phân biệt.';
  }
  return errors;
}

/** Thân yêu cầu POST /api/don-vi theo cách chọn đơn vị cha. */
export function unitBody(input: V) {
  const body = { name: collapse(input.name), type: collapse(input.type), description: clean(input.description), active: asBool(input.active) };
  if (input.parentId === NO_PARENT) return { ...body, parentMode: 'none', parentId: null, newParent: null };
  if (input.parentId === NEW_PARENT) {
    const none = input.newParentParentId === NO_PARENT;
    return { ...body, parentMode: 'new', parentId: null, newParent: { name: collapse(input.newParentName), type: collapse(input.newParentType), parentMode: none ? 'none' : 'existing', parentId: none ? null : Number(input.newParentParentId) } };
  }
  return { ...body, parentMode: 'existing', parentId: Number(input.parentId), newParent: null };
}

const overlaps = (m: { start: string; end: string }, start: string, end: string) => m.start <= (end || '9999-12-31') && start <= (m.end || '9999-12-31');

export function membershipErrors(data: OrganizationDto, input: V): V {
  const errors: V = {}, personId = Number(input.personId), unitId = Number(input.unitId), roleId = Number(input.roleId);
  if (!data.people.some((p) => p.id === personId && p.active)) errors.personId = 'Chọn người dùng đang hoạt động.';
  if (!data.units.some((u) => u.id === unitId && u.active)) errors.unitId = 'Chọn đơn vị đang hoạt động.';
  if (!data.roles.some((r) => r.id === roleId && r.active !== false)) errors.roleId = 'Chọn chức vụ hợp lệ.';
  if (!validDate(input.start)) errors.start = 'Nhập ngày tham gia hợp lệ.';
  if (input.end && !validDate(input.end)) errors.end = 'Nhập ngày kết thúc hợp lệ.';
  else if (input.end && input.end < input.start) errors.end = 'Ngày kết thúc phải từ ngày tham gia trở đi.';
  if (!isBool(input.primary)) errors.primary = 'Chọn đơn vị chính hoặc kiêm nhiệm.';
  if (errors.start || errors.end) return errors;
  const same = data.memberships.find((m) => m.personId === personId && m.unitId === unitId && m.roleId === roleId);
  if (same && !(same.end && same.end < input.start)) errors.roleId = 'Người dùng đã có chức vụ này tại đơn vị trong thời gian này. Không thể tạo trùng bộ ba.';
  const primary = asBool(input.primary);
  const others = data.memberships.filter((m) => m.personId === personId && !(m.unitId === unitId && m.roleId === roleId) && overlaps(m, input.start, input.end));
  const conflict = primary && others.find((m) => m.primary && m.unitId !== unitId);
  if (conflict) errors.primary = `Người dùng đã có đơn vị chính là ${data.units.find((u) => u.id === conflict.unitId)?.name || 'khác'} trong thời gian này. Hãy chọn “Không”.`;
  const mismatch = others.find((m) => m.unitId === unitId && m.primary !== primary);
  if (!conflict && mismatch) errors.primary = `Người dùng đã giữ chức vụ khác tại đơn vị này với “Đơn vị chính” = ${mismatch.primary ? 'Có' : 'Không'}. Hãy chọn cùng giá trị.`;
  return errors;
}

export function personErrors(data: OrganizationDto, input: V, personId: number | null = null): V {
  const errors: V = {}, name = clean(input.name).replace(/\s+/g, ' '), email = clean(input.email);
  if (name.length < 2 || name.length > 150) errors.name = 'Họ và tên cần có từ 2 đến 150 ký tự.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = 'Nhập email hợp lệ, ví dụ tennv@huit.edu.vn.';
  else if (data.people.some((p) => p.id !== Number(personId) && p.email.toLowerCase() === email.toLowerCase())) errors.email = 'Email đã được dùng cho tài khoản khác.';
  if (clean(input.academicTitle).length > 50) errors.academicTitle = 'Học hàm tối đa 50 ký tự.';
  if (clean(input.degree).length > 50) errors.degree = 'Học vị tối đa 50 ký tự.';
  if (clean(input.training).length > 100) errors.training = 'Tình trạng đào tạo tối đa 100 ký tự.';
  if (clean(input.phone) && !/^[0-9+().\s-]{6,20}$/.test(clean(input.phone))) errors.phone = 'Số điện thoại gồm 6–20 ký tự: chữ số, khoảng trắng, +, -, (, ), dấu chấm.';
  if (!isBool(input.isSystemAdmin)) errors.isSystemAdmin = 'Chọn có hoặc không.';
  if (personId === null && !isBool(input.active)) errors.active = 'Chọn trạng thái tài khoản.';
  return errors;
}

export const personBody = (input: V) => ({
  name: clean(input.name), email: clean(input.email), academicTitle: clean(input.academicTitle), degree: clean(input.degree),
  training: clean(input.training), phone: clean(input.phone), isSystemAdmin: asBool(input.isSystemAdmin),
  ...(input.active === undefined ? {} : { active: asBool(input.active) }),
});

export function passwordErrors(input: V): V {
  const errors: V = {}, next = String(input.newPassword ?? '');
  if (!input.currentPassword) errors.currentPassword = 'Nhập mật khẩu hiện tại.';
  if (next.length < 8 || next.length > 128) errors.newPassword = 'Mật khẩu cần từ 8 đến 128 ký tự.';
  else if (!/\p{L}/u.test(next) || !/\d/.test(next)) errors.newPassword = 'Mật khẩu cần có cả chữ và số.';
  else if (next.trim() !== next) errors.newPassword = 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng.';
  else if (next === input.currentPassword) errors.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (input.confirmPassword !== next) errors.confirmPassword = 'Mật khẩu nhập lại chưa khớp.';
  return errors;
}

export const PERMISSIONS: [string, string][] = [
  ['createTask', 'Tạo công việc'], ['assignTask', 'Giao việc cho thành viên'], ['approveResult', 'Duyệt kết quả'], ['evaluateResult', 'Đánh giá kết quả'],
  ['viewReport', 'Xem báo cáo của đơn vị'], ['manageMembers', 'Quản lý thành viên đơn vị'], ['includeChildren', 'Áp dụng quyền cho đơn vị con'],
];
export const UNIT_TYPES = ['Khoa', 'Bộ môn', 'Ban', 'Nhóm', 'Hội đồng', 'Trung tâm', 'Phòng thí nghiệm'];
