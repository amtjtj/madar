'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REQUESTS_PAGE,
  type ApprovalSettings,
  type CreateRequestRequest,
  type DecideRequestRequest,
  type RequestBox,
  type RequestCounts,
  type RequestDetail,
  type RequestKind,
  type RequestRoute,
  type RequestSummary,
} from '@madar/shared';

import { api } from '@/lib/api';

import { calendarKeys, requestKeys } from './keys';

/** One inbox box, newest first, thirty at a time (ADR 0028). */
export function useRequests(box: RequestBox) {
  return useInfiniteQuery({
    queryKey: requestKeys.list(box),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ box });
      if (pageParam) params.set('before', pageParam);
      return api<RequestSummary[]>(`/api/requests?${params.toString()}`);
    },
    getNextPageParam: (last) =>
      last.length === REQUESTS_PAGE ? (last.at(-1)?.id ?? undefined) : undefined,
  });
}

/** How many requests wait on me (the nav badge and the home card). */
export function useRequestCounts() {
  return useQuery({
    queryKey: requestKeys.counts,
    queryFn: () => api<RequestCounts>('/api/requests/counts'),
    staleTime: 30_000,
  });
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: requestKeys.one(id),
    queryFn: () => api<RequestDetail>(`/api/requests/${id}`),
  });
}

/** Who a request would go to, shown before it is sent. */
export function useRequestRoute(kind: RequestKind | null, amountToman: number | null) {
  return useQuery({
    queryKey: requestKeys.route(kind ?? '', amountToman),
    queryFn: () => {
      const params = new URLSearchParams({ kind: kind ?? 'general' });
      if (amountToman !== null) params.set('amountToman', String(amountToman));
      return api<RequestRoute>(`/api/requests/route?${params.toString()}`);
    },
    enabled: kind !== null,
    staleTime: 60_000,
  });
}

export function useCreateRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRequestRequest) =>
      api<RequestDetail>('/api/requests', { method: 'POST', body }),
    onSuccess: (detail) => {
      client.setQueryData(requestKeys.one(detail.id), detail);
      void client.invalidateQueries({ queryKey: requestKeys.all });
    },
  });
}

/**
 * Approve or reject. Optimistic: the step shows the decision at once and rolls back on error.
 */
export function useDecideRequest(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: DecideRequestRequest) =>
      api<RequestDetail>(`/api/requests/${id}/decide`, { method: 'POST', body }),
    onMutate: async (body) => {
      await client.cancelQueries({ queryKey: requestKeys.one(id) });
      const previous = client.getQueryData<RequestDetail>(requestKeys.one(id));
      if (previous) {
        const current = previous.steps.findIndex((s) => s.decision === null);
        client.setQueryData<RequestDetail>(requestKeys.one(id), {
          ...previous,
          can: { decide: false, cancel: false },
          steps: previous.steps.map((s, i) =>
            i === current
              ? {
                  ...s,
                  decision: body.decision,
                  comment: body.comment || null,
                  decidedAt: new Date().toISOString(),
                }
              : s,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) client.setQueryData(requestKeys.one(id), context.previous);
    },
    onSuccess: (detail) => client.setQueryData(requestKeys.one(id), detail),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: requestKeys.all });
      void client.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}

export function useCancelRequest(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/requests/${id}/cancel`, { method: 'POST' }),
    onSettled: () => void client.invalidateQueries({ queryKey: requestKeys.all }),
  });
}

export function useApprovalSettings() {
  return useQuery({
    queryKey: requestKeys.settings,
    queryFn: () => api<ApprovalSettings>('/api/settings/approvals'),
  });
}

export function useSaveApprovalSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ApprovalSettings) =>
      api<ApprovalSettings>('/api/settings/approvals', { method: 'PUT', body }),
    onSuccess: (saved) => client.setQueryData(requestKeys.settings, saved),
  });
}
