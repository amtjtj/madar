import { z } from 'zod';

import { MESSAGE_FILES_MAX, MESSAGE_MAX, REACTION_EMOJIS } from '../chat-text.js';
import { attachment } from '../files.js';

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
  /** Empty once deleted. */
  attachments: z.array(attachment),
  /** People mentioned with `<@id>` tokens in the body, with their current names. */
  mentions: z.array(personRef),
  /**
   * Who reacted with what. Everyone reading the conversation sees the same list; the web derives
   * «mine» from it, because the same message goes live to every reader.
   */
  reactions: z.array(z.object({ emoji: z.enum(REACTION_EMOJIS), members: z.array(personRef) })),
  /**
   * Active pins on tasks (plan 15c). A count only: the same message goes live to every reader,
   * and which of those tasks a reader sees is asked separately (`GET /api/messages/:id/tasks`).
   */
  pinnedCount: z.number().int(),
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
      mentions: z.array(personRef),
      /** The first file's name, for a message without text. */
      fileName: z.string().nullable(),
    })
    .nullable(),
  unreadCount: z.number().int(),
  /** Unread messages that mention the person (shown as «@» in the list). */
  unreadMentions: z.number().int(),
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
  /** More newer messages exist (only for a page opened `around` a message). */
  hasNewer: z.boolean().optional(),
});
export type MessagePage = z.infer<typeof messagePage>;

export const listMessagesQuery = z.object({
  /** Older than this message (scrolling up). */
  before: z.uuid().optional(),
  /** Newer than this message (catching up after a reconnect). */
  after: z.uuid().optional(),
  /** A page with this message in the middle (opening a search result). */
  around: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;

/** Text, files or both (`message_empty` when neither). Mentions are read from the body's tokens. */
export const sendMessageRequest = z.object({
  body: z.string().trim().max(MESSAGE_MAX).default(''),
  replyToId: z.uuid().nullable().optional(),
  uploadIds: z.array(z.uuid()).max(MESSAGE_FILES_MAX).default([]),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequest>;

export const editMessageRequest = z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX) });
export type EditMessageRequest = z.infer<typeof editMessageRequest>;

export const reactionRequest = z.object({ emoji: z.enum(REACTION_EMOJIS), active: z.boolean() });
export type ReactionRequest = z.infer<typeof reactionRequest>;

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

/**
 * The one realtime event that carries data (ADR 0022): a new, edited or deleted `Message`, sent by
 * the API after commit to the personal rooms of the people who may read it at that moment.
 */
export const CHAT_SOCKET = { message: 'chat:message' } as const;

/** «ساختن کار» from a message (plan phase-2-step-15c): the message is pinned to the new task. */
export const createTaskFromMessageRequest = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeId: z.uuid().nullable().optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  projectId: z.uuid().nullable().optional(),
});
export type CreateTaskFromMessageRequest = z.infer<typeof createTaskFromMessageRequest>;

/** The tasks a message is pinned to: those the reader sees, and how many others. */
export const messageTasks = z.object({
  visible: z.array(z.object({ id: z.uuid(), title: z.string() })),
  hidden: z.number().int(),
});
export type MessageTasks = z.infer<typeof messageTasks>;

export const chatSearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  conversationId: z.uuid().optional(),
  /** Older than this message (the next page). */
  before: z.uuid().optional(),
});
export type ChatSearchQuery = z.infer<typeof chatSearchQuery>;

export const chatSearchResult = z.object({
  message: z.object({
    id: z.uuid(),
    author: personRef,
    /** The text around the match, mentions as names. */
    excerpt: z.string(),
    createdAt: z.iso.datetime(),
  }),
  conversation: z.object({ id: z.uuid(), kind: z.enum(CONVERSATION_KINDS), title: z.string() }),
});
export type ChatSearchResult = z.infer<typeof chatSearchResult>;

export const chatSearchPage = z.object({
  items: z.array(chatSearchResult),
  nextBefore: z.uuid().nullable(),
});
export type ChatSearchPage = z.infer<typeof chatSearchPage>;

/** A project or department channel that can be exported (never a direct or group conversation). */
export const exportableChannel = z.object({
  id: z.uuid(),
  kind: z.enum(['project', 'department']),
  title: z.string(),
  messageCount: z.number().int(),
});
export type ExportableChannel = z.infer<typeof exportableChannel>;

export const chatExportQuery = z.object({
  /** Calendar days in the company's time zone, inclusive. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ChatExportQuery = z.infer<typeof chatExportQuery>;

/** One channel's messages for an export (the web writes the CSV with Persian headings). */
export const chatExport = z.object({
  channel: exportableChannel.pick({ id: true, kind: true, title: true }),
  /** More messages than one export holds: a narrower date range gets the rest. */
  truncated: z.boolean(),
  rows: z.array(
    z.object({
      createdAt: z.iso.datetime(),
      author: z.string(),
      /** Mentions as names; empty for a file-only message. */
      text: z.string(),
      files: z.array(z.string()),
      edited: z.boolean(),
    }),
  ),
});
export type ChatExport = z.infer<typeof chatExport>;
