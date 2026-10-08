import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionDto } from '@khoa/shared';
import { ApiError, api, get, onUnauthorized, send } from './api';

interface Session {
  ready: boolean;
  session: SessionDto | null;
  login: (email: string, password: string) => Promise<Record<string, string> | null>;
  logout: () => Promise<void>;
  /** Quyền dẫn xuất (giao diện chỉ ẩn/hiện; máy chủ kiểm tra lại mọi thao tác). */
  canCreate: boolean;
  canReview: boolean;
  isMember: boolean;
}

const Ctx = createContext<Session>(null!);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionDto | null>(null);

  useEffect(() => {
    get<SessionDto>('/api/auth/me').then(setSession).catch(() => setSession(null)).finally(() => setReady(true));
    return onUnauthorized(() => setSession(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await send<SessionDto>('POST', '/api/auth/login', { email: email.trim(), password });
    if (r.errors) return r.errors;
    setSession(r.value);
    return null;
  }, []);

  const logout = useCallback(async () => {
    try { await api('POST', '/api/auth/logout'); } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; }
    setSession(null);
  }, []);

  const value = useMemo<Session>(() => {
    const t = session?.tasks;
    return {
      ready, session, login, logout,
      canCreate: (t?.createUnitIds.length ?? 0) > 0,
      canReview: (t?.reviewUnitIds.length ?? 0) > 0 || (t?.assignUnitIds.length ?? 0) > 0,
      isMember: t?.isMember ?? false,
    };
  }, [ready, session, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
