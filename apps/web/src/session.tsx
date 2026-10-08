import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationDto, PortalDto, SessionDto, TaskCapabilitiesDto } from '@khoa/shared';
import { ApiError, api, get, onUnauthorized, send, type SendResult } from './api/client';

const EMPTY_ORG: OrganizationDto = { units: [], people: [], roles: [], memberships: [] };
const EMPTY_TASKS: TaskCapabilitiesDto = { createUnitIds: [], assignUnitIds: [], reviewUnitIds: [], reportUnitIds: [], isMember: false };

interface SessionApi {
  ready: boolean;
  loadError: string;
  session: SessionDto | null;
  org: OrganizationDto;
  portals: PortalDto[];
  defaultPortal: string;
  tasks: TaskCapabilitiesDto;
  isAdmin: boolean;
  canManageUnit: (unitId: number) => boolean;
  login: (email: string, password: string) => Promise<SendResult<SessionDto>>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  reloadOrg: () => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<SessionApi | null>(null);
export const useSession = (): SessionApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
};

/** Phiên đăng nhập + dữ liệu tổ chức (đơn vị, nhân sự, chức vụ, thành viên) dùng chung cho mọi trang. */
export function SessionProvider({ children, onExpired }: { children: ReactNode; onExpired: () => void }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  const boot = useCallback(async () => {
    setReady(false);
    setLoadError('');
    try {
      setSession(await get<SessionDto>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession(null);
      else setLoadError((e as Error).message || 'Không kết nối được máy chủ.');
    }
    setReady(true);
  }, []);

  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => onUnauthorized(() => {
    setSession((s) => {
      if (s) onExpired();
      return null;
    });
    qc.clear();
  }), [qc, onExpired]);

  const orgQuery = useQuery({ queryKey: ['org'], queryFn: () => get<OrganizationDto>('/api/to-chuc'), enabled: !!session, staleTime: 60_000 });

  const value = useMemo<SessionApi>(() => {
    const portals = session?.portals?.length
      ? session.portals
      : session
        ? [...(session.user.isSystemAdmin ? [{ key: 'admin', roleLabel: 'Quản trị hệ thống', title: 'Trang quản trị', scope: '' } as PortalDto] : []),
          { key: 'ca-nhan', roleLabel: session.user.roleSummary || 'Người dùng', title: 'Trang cá nhân', scope: '' } as PortalDto]
        : [];
    return {
      ready: ready && (!session || !orgQuery.isLoading),
      loadError: loadError || (orgQuery.error ? (orgQuery.error as Error).message : ''),
      session,
      org: orgQuery.data ?? EMPTY_ORG,
      portals,
      defaultPortal: portals[0]?.key ?? 'ca-nhan',
      tasks: session?.tasks ?? EMPTY_TASKS,
      isAdmin: session?.user.isSystemAdmin === true,
      canManageUnit: (unitId: number) => !!session?.capabilities.manageableUnitIds.includes(Number(unitId)),
      login: async (email, password) => {
        const result = await send<SessionDto>('POST', '/api/auth/login', { email: email.trim(), password });
        if (result.value) {
          qc.clear();
          setSession(result.value);
        }
        return result;
      },
      logout: async () => {
        try { await api('POST', '/api/auth/logout'); } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; }
        qc.clear();
        setSession(null);
      },
      refreshSession: async () => { setSession(await get<SessionDto>('/api/auth/me')); },
      reloadOrg: async () => { await qc.invalidateQueries({ queryKey: ['org'] }); },
      retry: () => { void boot(); void orgQuery.refetch(); },
    };
  }, [session, ready, loadError, orgQuery, qc, boot]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
