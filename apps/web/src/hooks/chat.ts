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
  CreateTaskFromMessageRequest,
  MessagePage,
  MessageTasks,
  ReactionEmoji,
  Task,
  Upload,
} from '@madar/shared';

import { api } from '@/lib/api';
import { applyLiveMessage, findMessage, toggleReaction } from '@/lib/chat';

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
    mutationFn: (input: {
      body: string;
      replyTo?: Message | null;
      tempId: string;
      uploads?: Upload[];
      /** People picked for the body's tokens, so the pending bubble shows their names. */
      mentions?: { id: string; displayName: string }[];
    }) =>
      api<Message>(`/api/conversations/${id}/messages`, {
        method: 'POST',
        body: {
          body: input.body,
          replyToId: input.replyTo?.id ?? null,
          uploadIds: (input.uploads ?? []).map((u) => u.id),
        },
      }),
    onMutate: ({ body, replyTo, tempId, uploads = [], mentions = [] }) => {
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
        attachments: uploads.map((u) => ({
          ...u,
          uploadedBy: me,
          createdAt: new Date().toISOString(),
          subject: null,
          can: { delete: false },
        })),
        mentions,
        reactions: [],
        pinnedCount: 0,
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

/** My reaction on or off, shown at once; the server's copy (also sent live) replaces it. */
export function useReact(me: { id: string; displayName: string }) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: Message; emoji: ReactionEmoji; active: boolean }) =>
      api<Message>(`/api/messages/${input.message.id}/reactions`, {
        method: 'PUT',
        body: { emoji: input.emoji, active: input.active },
      }),
    // Always toggle the newest cached copy: a live update may have arrived since it was rendered.
    onMutate: ({ message, emoji, active }) => {
      const current = findMessage(client, message.conversationId, message.id) ?? message;
      applyLiveMessage(client, toggleReaction(current, emoji, active, me));
    },
    onSuccess: (message) => applyLiveMessage(client, message),
    onError: (_e, { message, emoji, active }) => {
      const current = findMessage(client, message.conversationId, message.id);
      if (current) applyLiveMessage(client, toggleReaction(current, emoji, !active, me));
    },
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

/** Where a message is pinned: tasks I see, and a count of the others (asked on demand). */
export function useMessageTasks(messageId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.messageTasks(messageId),
    enabled,
    queryFn: () => api<MessageTasks>(`/api/messages/${messageId}/tasks`),
  });
}

/** One more pin on a cached message, so «کار شد» shows at once. */
export function useCountPin() {
  const client = useQueryClient();
  return (message: Message) => {
    const current = findMessage(client, message.conversationId, message.id) ?? message;
    applyLiveMessage(client, { ...current, pinnedCount: current.pinnedCount + 1 });
    void client.invalidateQueries({ queryKey: chatKeys.messageTasks(message.id) });
  };
}

/** «ساختن کار» from a message: the task is created and the message pinned to it. */
export function useCreateTaskFromMessage() {
  const client = useQueryClient();
  const countPin = useCountPin();
  return useMutation({
    mutationFn: ({ message, body }: { message: Message; body: CreateTaskFromMessageRequest }) =>
      api<Task>(`/api/messages/${message.id}/task`, { method: 'POST', body }),
    onSuccess: (_task, { message }) => {
      countPin(message);
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['today'] });
    },
  });
}
