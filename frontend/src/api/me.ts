import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import { appUrl } from '@/lib/runtime';
import { KEYS, writeLocal } from '@/lib/storage';
import type { AuthProviders, Me } from './types';

export const meKey = ['me'] as const;
export const providersKey = ['auth', 'providers'] as const;

export function fetchMe(): Promise<Me> {
  return api.get<Me>('/v1/me', { silent401: true });
}

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 30_000, retry: false });
}

export function useAuthProviders() {
  return useQuery({
    queryKey: providersKey,
    queryFn: () => api.get<AuthProviders>('/v1/auth/providers', { silent401: true }),
    staleTime: Infinity,
  });
}

/** POST /v1/auth/logout → clear caches + local snapshot → full navigation to /app/login?next=/app/ */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/v1/auth/logout', undefined, { silent401: true });
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    },
    onSettled: () => {
      qc.clear();
      writeLocal(KEYS.me, null);
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      window.location.assign(`${appUrl('/login')}?next=${encodeURIComponent(appUrl('/'))}`);
    },
  });
}

export function canCreateProject(me: Me | undefined): boolean {
  if (!me) return false;
  return me.role === 'ADMIN' || me.projects.some((p) => p.role === 'MANAGER');
}
