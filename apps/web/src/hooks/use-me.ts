'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@madar/shared';

import { api, ApiClientError } from '@/lib/api';

export const ME_KEY = ['me'] as const;

async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api<MeResponse>('/api/me');
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

/** The signed-in user, their company and pending security steps. `null` when signed out. */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 60_000, retry: false });
}

/**
 * Re-fetches /me and writes it to the cache before returning, so the app gate never acts on
 * stale "pending" steps right after a sign-in, password change or 2FA setup.
 */
export function useRefreshMe() {
  const client = useQueryClient();
  return async () => {
    const me = await fetchMe();
    client.setQueryData(ME_KEY, me);
    return me;
  };
}

/** Where the user must go next, or null when they can use the app. */
export function nextStep(me: MeResponse | null | undefined): string | null {
  if (me === null) return '/login';
  if (!me) return null;
  if (me.pending.passwordChange) return '/change-password';
  if (me.pending.twoFactorSetup) return '/setup-2fa';
  if (me.pending.tenantSelection) return '/select-tenant';
  return null;
}
