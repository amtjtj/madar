'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  Conversation,
  ConversationSummary,
  CreateGroupRequest,
  Message,
  MessagePage,
} from '@madar/shared';

import { api } from '@/lib/api';
import { applyLiveMessage } from '@/lib/chat';

import { chatKeys, notificationKeys } from './keys';

type Pages = InfiniteData<MessagePage, string | undefined>;

export function useConversations() {
  return useQuery({
    queryKey: chatKeys.list,
    queryFn: () => api<ConversationSummary[]>('/api/conversations'),
  });
}

/** Unread across conversations (navigation). Realtime hints refresh it; a slow poll covers gaps. */
export function useChatUnread() {
  return useQuery({
    queryKey: chatKeys.unread,
    queryFn: () => api<{ count: number }>('/api/conversations/unread-count'),
    select: (data) => data.count,
    refetchInterval: 120_000,
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: chatKeys.conversation(id),
    queryFn: () => api<Conversation>(`/api/conversations/${id}`),
  });
}

export function useProjectConversation(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.byProject(projectId),
    enabled,
    queryFn: () => api<ConversationSummary>(`/api/conversations/by-project/${projectId}`),
    retry: false,
  });
}

/** Newest page first; older pages are loaded on demand. */
export function useMessages(id: string) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        `/api/conversations/${id}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
    // Live messages arrive through the socket; a refetch would only reorder the cache.
    staleTime: Infinity,
  });
}

function refreshLists(client: QueryClient) {
  void client.invalidateQueries({ queryKey: chatKeys.list });
  void client.invalidateQueries({ queryKey: chatKeys.unread });
}

/** Send optimistically: a pending bubble appears at once and is swapped for the server's. */
export function useSendMessage(id: string, me: { id: string; displayName: string }) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; replyTo?: Message | null; tempId: string }) =>
      api<Message>(`/api/conversations/${id}/messages`, {
        method: 'POST',
        body: { body: input.body, replyToId: input.replyTo?.id ?? null },
      }),
    onMutate: ({ body, replyTo, tempId }) => {
      applyLiveMessage(client, {
        id: tempId,
        conversationId: id,
        author: me,
        body,
        replyTo: replyTo
          ? {
              id: replyTo.id,
              author: replyTo.author,
              body: replyTo.body,
              deleted: replyTo.deleted,
            }
          : null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      });
    },
    onSuccess: (message, { tempId }) => {
      const key = chatKeys.messages(id);
      const data = client.getQueryData<Pages>(key);
      if (data) {
        client.setQueryData<Pages>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.filter((m) => m.id !== tempId),
          })),
        });
      }
      applyLiveMessage(client, message);
    },
    onError: (_e, { tempId }) => {
      const key = chatKeys.messages(id);
      const data = client.getQueryData<Pages>(key);
      if (data) {
        client.setQueryData<Pages>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.filter((m) => m.id !== tempId),
          })),
        });
      }
    },
    onSettled: () => refreshLists(client),
  });
}

export function useEditMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api<Message>(`/api/messages/${id}`, { method: 'PATCH', body: { body } }),
    onSuccess: (message) => applyLiveMessage(client, message),
  });
}

export function useDeleteMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (message: Message) =>
      api<undefined>(`/api/messages/${message.id}`, { method: 'DELETE' }),
    onSuccess: (_d, message) => applyLiveMessage(client, { ...message, body: '', deleted: true }),
    onSettled: () => refreshLists(client),
  });
}

export function useMarkRead(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<undefined>(`/api/conversations/${id}/read`, { method: 'POST', body: { messageId } }),
    onSuccess: () => {
      refreshLists(client);
      // Reading also clears this conversation's chat notifications.
      void client.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

function useConversationMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useStartDirect() {
  return useConversationMutation((memberId: string) =>
    api<Conversation>('/api/conversations/direct', { method: 'POST', body: { memberId } }),
  );
}

export function useCreateGroup() {
  return useConversationMutation((body: CreateGroupRequest) =>
    api<Conversation>('/api/conversations/group', { method: 'POST', body }),
  );
}

export function useRenameGroup(id: string) {
  return useConversationMutation((title: string) =>
    api<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: { title } }),
  );
}

export function useAddMembers(id: string) {
  return useConversationMutation((memberIds: string[]) =>
    api<Conversation>(`/api/conversations/${id}/members`, { method: 'POST', body: { memberIds } }),
  );
}

export function useRemoveMember(id: string) {
  return useConversationMutation((memberId: string) =>
    api<undefined>(`/api/conversations/${id}/members/${memberId}`, { method: 'DELETE' }),
  );
}

export function useLeaveGroup(id: string) {
  return useConversationMutation(() =>
    api<undefined>(`/api/conversations/${id}/leave`, { method: 'POST' }),
  );
}

export function useMuteConversation(id: string) {
  return useConversationMutation((muted: boolean) =>
    api<undefined>(`/api/conversations/${id}/mute`, { method: 'PUT', body: { muted } }),
  );
}
