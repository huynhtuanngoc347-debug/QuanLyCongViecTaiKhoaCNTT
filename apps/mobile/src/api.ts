/**
 * Gọi API NestJS. Phiên đăng nhập giữ bằng cookie httpOnly (access token 15 phút + refresh token).
 * Khi access token hết hạn (401), tự gọi /api/auth/refresh một lần rồi thử lại.
 * Lỗi nhập liệu (400) trả { errors } để giao diện hiện cạnh từng ô.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public errors: Record<string, string> | null = null) {
    super(message);
  }
}

export type SendResult<T> = { value: T; errors?: undefined } | { value?: undefined; errors: Record<string, string> };

export const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const OFFLINE = 'Không kết nối được máy chủ. Kiểm tra API (NestJS) đang chạy rồi thử lại.';
const listeners = new Set<() => void>();

/** Đăng ký nhận báo khi phiên hết hạn (để quay về màn hình đăng nhập). */
export function onUnauthorized(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let refreshing: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(BASE + '/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

const NO_REFRESH = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

async function raw(method: string, path: string, body?: unknown, isForm = false, retry = true): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined || isForm ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (response.status === 401 && retry && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) return raw(method, path, body, isForm, false);
  }
  return response;
}

async function parse<T>(response: Response, path: string): Promise<T> {
  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  if (response.ok) return payload as T;
  const p = payload as { message?: string; errors?: Record<string, string> } | null;
  if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') listeners.forEach((fn) => fn());
  if (response.status === 413) throw new ApiError(413, 'Tệp quá lớn. Mỗi tệp tối đa 20 MB.');
  throw new ApiError(response.status, p?.message || `Máy chủ trả lỗi ${response.status}.`, p?.errors ?? null);
}

/**
 * Mở (xem) hoặc tải tệp đính kèm. Link thường không đi qua raw() nên không tự làm mới phiên
 * (access token 15 phút) → kiểm phiên trước. Cửa sổ xem mở ngay lúc bấm (tránh bị chặn popup) rồi mới gán địa chỉ.
 */
export async function openFile(url: string, view: boolean): Promise<void> {
  const win = view ? window.open('about:blank', '_blank') : null;
  if (win) win.opener = null;
  try {
    if ((await raw('GET', '/api/auth/me')).status === 401) {
      win?.close();
      listeners.forEach((fn) => fn());
      return;
    }
  } catch { /* mất kết nối: vẫn thử mở, trình duyệt sẽ báo lỗi */ }
  if (win) { win.location.href = url; return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Gọi API; lỗi ném ApiError. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  return parse<T>(await raw(method, path, body), path);
}

export const get = <T>(path: string) => api<T>('GET', path);

/** Gửi biểu mẫu: lỗi theo trường (400) trả { errors }, lỗi khác ném ra. */
export async function send<T = unknown>(method: string, path: string, body?: unknown): Promise<SendResult<T>> {
  try {
    return { value: await api<T>(method, path, body) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && e.errors) return { errors: e.errors };
    throw e;
  }
}

/** Gửi multipart/form-data (nộp kết quả kèm tệp). */
export async function upload<T = unknown>(path: string, form: FormData): Promise<SendResult<T>> {
  try {
    return { value: await parse<T>(await raw('POST', path, form, true), path) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && e.errors) return { errors: e.errors };
    throw e;
  }
}
