'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConvertDecisionRequest,
  CreateMeetingRequest,
  Meeting,
  MeetingList,
  MeetingRange,
  MeetingSummary,
  MinutesTasks,
  SaveMinutesRequest,
  Task,
  UpdateMeetingRequest,
  UpdateSeriesRequest,
} from '@madar/shared';

import { api } from '@/lib/api';
import { withResponse } from '@/lib/meetings';

import { meetingKeys, workKeys } from './keys';

export function useMeetings(range: MeetingRange) {
  return useInfiniteQuery({
    queryKey: meetingKeys.list(range),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ range });
      if (pageParam) params.set('cursor', pageParam);
      return api<MeetingList>(`/api/meetings?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

/** Today's meetings the person takes part in (the today card). */
export function useTodayMeetings() {
  return useQuery({
    queryKey: meetingKeys.today,
    queryFn: () => api<MeetingSummary[]>('/api/meetings/today'),
  });
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: meetingKeys.meeting(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api<Meeting>(`/api/meetings/${id}`),
  });
}

/** Every change answers with the whole meeting: it goes straight into the cache. */
function useMeetingMutation<V>(fn: (vars: V) => Promise<Meeting>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (meeting) => client.setQueryData(meetingKeys.meeting(meeting.id), meeting),
    onSettled: () => client.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

export function useSaveMeeting() {
  return useMeetingMutation(
    ({ id, body }: { id?: string; body: CreateMeetingRequest | UpdateMeetingRequest }) =>
      id
        ? api<Meeting>(`/api/meetings/${id}`, { method: 'PATCH', body })
        : api<Meeting>('/api/meetings', { method: 'POST', body }),
  );
}

export function useCancelMeeting() {
  return useMeetingMutation((id: string) =>
    api<Meeting>(`/api/meetings/${id}/cancel`, { method: 'POST' }),
  );
}

export function useSaveMinutes(id: string) {
  return useMeetingMutation((body: SaveMinutesRequest) =>
    api<Meeting>(`/api/meetings/${id}/minutes`, { method: 'PUT', body }),
  );
}

export function useAddDecision(id: string) {
  return useMeetingMutation((text: string) =>
    api<Meeting>(`/api/meetings/${id}/decisions`, { method: 'POST', body: { text } }),
  );
}

export function useRemoveDecision(id: string) {
  return useMeetingMutation((decisionId: string) =>
    api<Meeting>(`/api/meetings/${id}/decisions/${decisionId}`, { method: 'DELETE' }),
  );
}

export function useConvertDecision(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ decisionId, body }: { decisionId: string; body: ConvertDecisionRequest }) =>
      api<Task>(`/api/meetings/${id}/decisions/${decisionId}/task`, { method: 'POST', body }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: meetingKeys.meeting(id) });
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
    },
  });
}

/** Removing a minutes file goes through the attachment endpoint. */
export function useDeleteMinutesFile(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) =>
      api<undefined>(`/api/attachments/${fileId}`, { method: 'DELETE' }),
    onSettled: () => client.invalidateQueries({ queryKey: meetingKeys.meeting(id) }),
  });
}

/** «می‌آیم» / «نمی‌آیم», shown at once and rolled back if refused. */
export function useRespond(id: string, memberId: string | undefined) {
  const client = useQueryClient();
  const key = meetingKeys.meeting(id);
  return useMutation({
    mutationFn: (response: 'accepted' | 'declined') =>
      api<Meeting>(`/api/meetings/${id}/response`, { method: 'PUT', body: { response } }),
    onMutate: (response) => {
      const before = client.getQueryData<Meeting>(key);
      if (before) client.setQueryData(key, withResponse(before, memberId, response));
      return { before };
    },
    onError: (_error, _response, context) => client.setQueryData(key, context?.before),
    onSuccess: (meeting) => client.setQueryData(key, meeting),
    onSettled: () => client.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

/** «این و جلسه‌های بعدی»: answers with the next meeting of the series (null when none is left). */
export function useUpdateSeries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, body }: { seriesId: string; body: UpdateSeriesRequest }) =>
      api<Meeting | null>(`/api/meeting-series/${seriesId}`, { method: 'PATCH', body }),
    onSettled: () => client.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

export function useCancelSeries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (seriesId: string) =>
      api<undefined>(`/api/meeting-series/${seriesId}/cancel`, { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

/** The tasks a meeting's minutes are pinned to (loaded when the list opens). */
export function useMinutesTasks(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...meetingKeys.meeting(id), 'pin-tasks'],
    enabled,
    queryFn: () => api<MinutesTasks>(`/api/meetings/${id}/pin-tasks`),
  });
}
