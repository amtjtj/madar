/**
 * Internal chat (phase 2, step 15a; ADR 0022). Project and department channels take their members
 * from `project_members` and `department_memberships` (never a copy); `conversation_members` holds
 * the membership of direct and group conversations and everyone's own read and mute state.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId } from './columns.js';
import { tenants } from './control.js';
import { departments, members } from './org.js';
import { projects } from './work.js';

export const conversationKind = pgEnum('conversation_kind', [
  'project',
  'department',
  'direct',
  'group',
]);
export const conversationRole = pgEnum('conversation_role', ['owner', 'member']);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: conversationKind('kind').notNull(),
    projectId: uuid('project_id'),
    departmentId: uuid('department_id'),
    /** Group name; project and department channels show their source's name. */
    title: text('title'),
    /** Both member ids, sorted (direct only). */
    directKey: text('direct_key'),
    createdBy: uuid('created_by'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('conversations_tenant_id_id_key').on(t.tenantId, t.id),
    unique('conversations_tenant_project_key').on(t.tenantId, t.projectId),
    unique('conversations_tenant_department_key').on(t.tenantId, t.departmentId),
    unique('conversations_tenant_direct_key').on(t.tenantId, t.directKey),
    check(
      'conversations_kind_columns',
      sql`(${t.kind} = 'project') = (${t.projectId} is not null)
        and (${t.kind} = 'department') = (${t.departmentId} is not null)
        and (${t.kind} = 'direct') = (${t.directKey} is not null)
        and (${t.kind} <> 'group' or ${t.title} is not null)`,
    ),
    foreignKey({
      name: 'conversations_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'conversations_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'conversations_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    memberId: uuid('member_id').notNull(),
    role: conversationRole('role').notNull().default('member'),
    lastReadMessageId: uuid('last_read_message_id'),
    muted: boolean('muted').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Left or removed (direct and group); channels never set it. */
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.conversationId, t.memberId] }),
    index('conversation_members_member_idx').on(t.tenantId, t.memberId),
    foreignKey({
      name: 'conversation_members_conversation_fk',
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'conversation_members_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const messages = pgTable(
  'messages',
  {
    /** UUIDv7: ordered by time, so «newer than» is «greater than». */
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    replyToId: uuid('reply_to_id'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('messages_tenant_id_id_key').on(t.tenantId, t.id),
    // Target of the reply FK below: a reply always points into its own conversation.
    unique('messages_tenant_conversation_id_key').on(t.tenantId, t.conversationId, t.id),
    index('messages_conversation_idx').on(t.tenantId, t.conversationId, t.id),
    foreignKey({
      name: 'messages_conversation_fk',
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'messages_author_fk',
      columns: [t.tenantId, t.authorId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'messages_reply_to_fk',
      columns: [t.tenantId, t.conversationId, t.replyToId],
      foreignColumns: [t.tenantId, t.conversationId, t.id],
    }).onDelete('restrict'),
  ],
);

/** Who a message mentions (plan phase-2-step-15b): for notifications and the «@» count. */
export const messageMentions = pgTable(
  'message_mentions',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.messageId, t.memberId] }),
    index('message_mentions_member_idx').on(t.tenantId, t.memberId, t.messageId),
    foreignKey({
      name: 'message_mentions_message_fk',
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'message_mentions_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** One row per person, message and emoji; the set is fixed (`REACTION_EMOJIS` in shared). */
export const messageReactions = pgTable(
  'message_reactions',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull(),
    memberId: uuid('member_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.messageId, t.memberId, t.emoji] }),
    check('message_reactions_emoji_check', sql`${t.emoji} in ('👍', '❤️', '😂', '🎉', '🙏', '👀')`),
    foreignKey({
      name: 'message_reactions_message_fk',
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'message_reactions_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);
