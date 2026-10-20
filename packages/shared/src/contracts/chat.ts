import { z } from 'zod';

import { MESSAGE_MAX } from '../chat-text.js';

/** Internal chat (plan phase-2-step-15a, ADR 0022). */
export const CONVERSATION_KINDS = ['project', 'department', 'direct', 'group'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

const personRef = z.object({ id: z.uuid(), displayName: z.string() });

export const message = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  author: personRef,
  /** Empty once deleted. */
  body: z.string(),
  replyTo: z
    .object({ id: z.uuid(), author: personRef, body: z.string(), deleted: z.boolean() })
    .nullable(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  deleted: z.boolean(),
});
export type Message = z.infer<typeof message>;

export const conversationSummary = z.object({
  id: z.uuid(),
  kind: z.enum(CONVERSATION_KINDS),
  /** Project, department or group name; the other person for a direct conversation. */
  title: z.string(),
  /** The other person (direct only), for the avatar. */
  peer: personRef.nullable(),
  projectId: z.uuid().nullable(),
  departmentId: z.uuid().nullable(),
  lastMessage: z
    .object({
      author: personRef,
      body: z.string(),
      createdAt: z.iso.datetime(),
      deleted: z.boolean(),
    })
    .nullable(),
  unreadCount: z.number().int(),
  muted: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

export const conversationMember = personRef.extend({
  /** Project observers and department viewers read only. */
  canPost: z.boolean(),
  owner: z.boolean(),
});
export type ConversationMember = z.infer<typeof conversationMember>;

export const conversation = conversationSummary.extend({
  members: z.array(conversationMember),
  /** The person's own last read message (the «unread» line is drawn after it). */
  lastReadMessageId: z.uuid().nullable(),
  can: z.object({
    post: z.boolean(),
    /** Group: rename and remove members (its owner). */
    manage: z.boolean(),
    addMembers: z.boolean(),
    leave: z.boolean(),
  }),
});
export type Conversation = z.infer<typeof conversation>;

export const messagePage = z.object({
  items: z.array(message),
  /** More older messages exist. */
  hasMore: z.boolean(),
});
export type MessagePage = z.infer<typeof messagePage>;

export const listMessagesQuery = z.object({
  /** Older than this message (scrolling up). */
  before: z.uuid().optional(),
  /** Newer than this message (catching up after a reconnect). */
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;

export const sendMessageRequest = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX),
  replyToId: z.uuid().nullable().optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequest>;

export const editMessageRequest = z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX) });
export type EditMessageRequest = z.infer<typeof editMessageRequest>;

export const directConversationRequest = z.object({ memberId: z.uuid() });
export const createGroupRequest = z.object({
  title: z.string().trim().min(1).max(80),
  memberIds: z.array(z.uuid()).min(1).max(49),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequest>;
export const renameGroupRequest = z.object({ title: z.string().trim().min(1).max(80) });
export const addMembersRequest = z.object({ memberIds: z.array(z.uuid()).min(1).max(49) });
export const muteRequest = z.object({ muted: z.boolean() });
export const markReadRequest = z.object({ messageId: z.uuid() });

/** Socket events for chat rooms (ADR 0022): the only realtime messages that carry data. */
export const CHAT_SOCKET = {
  /** client → server: join a conversation's room after an access check. */
  join: 'chat:join',
  leave: 'chat:leave',
  /** server → client, in the room: a new, edited or deleted message (`Message`). */
  message: 'chat:message',
} as const;
