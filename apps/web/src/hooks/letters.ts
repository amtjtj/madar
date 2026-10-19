'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Letter,
  LetterFolder,
  LetterList,
  LetterUnreadCount,
  ReferLetterRequest,
  SaveLetterRequest,
} from '@madar/shared';

import { api } from '@/lib/api';

import { letterKeys } from './keys';

export function useLetters(folder: LetterFolder, q: string) {
  return useInfiniteQuery({
    queryKey: letterKeys.list(folder, q),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ folder });
      if (q) params.set('q', q);
      if (pageParam) params.set('before', pageParam);
      return api<LetterList>(`/api/letters?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: (previous) => previous,
  });
}

/** Unread letters (sidebar and header). Realtime hints refresh it; a slow poll covers gaps. */
export function useLetterUnread() {
  return useQuery({
    queryKey: letterKeys.unread,
    queryFn: () => api<LetterUnreadCount>('/api/letters/unread-count'),
    select: (data) => data.count,
    refetchInterval: 120_000,
  });
}

/** Opening a letter marks it read, so the folders and the counter refetch after it loads. */
export function useLetter(id: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: letterKeys.letter(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const letter = await api<Letter>(`/api/letters/${id}`);
      if (letter.receivedAs && !letter.read) {
        void client.invalidateQueries({ queryKey: letterKeys.unread });
        void client.invalidateQueries({ queryKey: ['letters', 'list'] });
      }
      return letter;
    },
  });
}

function useLetterMutation<V, R extends Letter | undefined>(fn: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (letter) => {
      if (letter) client.setQueryData(letterKeys.letter(letter.id), letter);
    },
    onSettled: () => client.invalidateQueries({ queryKey: letterKeys.all }),
  });
}

/** Creates a draft, or saves an existing one. */
export function useSaveDraft() {
  return useLetterMutation(({ id, body }: { id?: string; body: SaveLetterRequest }) =>
    id
      ? api<Letter>(`/api/letters/${id}`, { method: 'PATCH', body })
      : api<Letter>('/api/letters', { method: 'POST', body }),
  );
}

export function useSendLetter() {
  return useLetterMutation((id: string) =>
    api<Letter>(`/api/letters/${id}/send`, { method: 'POST' }),
  );
}

export function useDeleteDraft() {
  return useLetterMutation(async (id: string) => {
    await api<undefined>(`/api/letters/${id}`, { method: 'DELETE' });
    return undefined;
  });
}

export function useReferLetter() {
  return useLetterMutation(({ id, body }: { id: string; body: ReferLetterRequest }) =>
    api<Letter>(`/api/letters/${id}/refer`, { method: 'POST', body }),
  );
}

/** Archive for this person only, optimistically. */
export function useArchiveLetter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api<undefined>(`/api/letters/${id}/${archived ? 'archive' : 'unarchive'}`, {
        method: 'POST',
      }),
    onMutate: ({ id, archived }) => {
      const before = client.getQueryData<Letter>(letterKeys.letter(id));
      if (before) client.setQueryData(letterKeys.letter(id), { ...before, archived });
      return { before };
    },
    onError: (_e, { id }, context) => client.setQueryData(letterKeys.letter(id), context?.before),
    onSettled: () => client.invalidateQueries({ queryKey: letterKeys.all }),
  });
}

export function useDeleteLetterFile(letterId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/api/attachments/${id}`, { method: 'DELETE' }),
    onSettled: () =>
      letterId ? client.invalidateQueries({ queryKey: letterKeys.letter(letterId) }) : undefined,
  });
}
