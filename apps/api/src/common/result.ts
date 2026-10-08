import { HttpException } from '@nestjs/common';

/**
 * Kết quả nghiệp vụ (giống ServiceResult<T> của bản C#): thành công kèm dữ liệu, lỗi theo trường (400),
 * hoặc lỗi kèm mã trạng thái. Hàm nghiệp vụ TRẢ VỀ kết quả (không ném) để giao dịch vẫn commit
 * những gì cần giữ, ví dụ nhật ký đăng nhập sai.
 */
export type Result<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'invalid'; errors: Record<string, string> }
  | { kind: 'fail'; status: number; message: string };

export const ok = <T>(value: T): Result<T> => ({ kind: 'ok', value });
export const invalid = <T = never>(errors: Record<string, string>): Result<T> => ({ kind: 'invalid', errors });
export const invalidField = <T = never>(field: string, message: string): Result<T> => ({ kind: 'invalid', errors: { [field]: message } });
export const fail = <T = never>(status: number, message: string): Result<T> => ({ kind: 'fail', status, message });
export const forbidden = <T = never>(message = 'Bạn không có quyền thực hiện thao tác này.'): Result<T> => fail(403, message);
export const notFound = <T = never>(message: string): Result<T> => fail(404, message);
export const conflict = <T = never>(message: string): Result<T> => fail(409, message);
export const unauthorized = <T = never>(message = 'Phiên đăng nhập không còn hiệu lực.'): Result<T> => fail(401, message);

/** Lỗi HTTP có thân { message, errors? } đúng định dạng giao diện đang dùng. */
export class ApiException extends HttpException {
  constructor(status: number, message: string, errors?: Record<string, string>) {
    super(errors ? { message, errors } : { message }, status);
  }
}

export class FieldErrorsException extends ApiException {
  constructor(errors: Record<string, string>) {
    super(400, 'Vui lòng kiểm tra các trường được đánh dấu.', errors);
  }
}

/** Đổi Result sang giá trị trả về của controller; lỗi thành ngoại lệ HTTP. */
export function unwrap<T>(result: Result<T>): T {
  if (result.kind === 'ok') return result.value;
  if (result.kind === 'invalid') throw new FieldErrorsException(result.errors);
  throw new ApiException(result.status, result.message || 'Không thực hiện được thao tác.');
}

export function errorsOf(errors: Record<string, string>): boolean {
  return Object.keys(errors).length > 0;
}
