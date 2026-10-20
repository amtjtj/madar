import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, uuidv7, type Tx } from '@madar/db';
import {
  CHAT_SOCKET,
  REALTIME_EVENTS,
  canStillEdit,
  directKey,
  type Conversation,
  type ConversationMember,
  type ConversationSummary,
  type CreateGroupRequest,
  type ListMessagesQuery,
  type Message,
  type MessagePage,
  type SendMessageRequest,
} from '@madar/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { TenantContext } from '../common/context.js';
import { ApiError, badRequest, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import {
  audienceOf,
  postableConversations,
  visibleConversations,
  visibleConversationsRaw,
} from './access.js';

type ConversationRow = typeof s.conversations.$inferSelect;
type MessageRow = typeof s.messages.$inferSelect;

const readOnly = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'chat_read_only', 'You can only read this conversation');
const ownerOnly = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'group_owner_only', 'Only the group owner can do this');
const editWindow = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    'message_edit_window',
    'Messages can be changed for 15 minutes only',
  );

const MAX_GROUP = 50;

/** «Read» means: author is someone else, not deleted, newer than my last read (or my joining). */
function unreadCondition(memberId: string) {
  return sql`m.author_id <> ${memberId} and m.deleted_at is null and (
    case when mine.last_read_message_id is not null then m.id > mine.last_read_message_id
    else m.created_at > coalesce(
      -- Channels: when I joined the project or department (my state row is created lazily).
      (select pm.created_at from project_members pm where pm.project_id = c.project_id and pm.member_id = ${memberId}),
      (select dm.created_at from department_memberships dm where dm.department_id = c.department_id and dm.member_id = ${memberId}),
      mine.joined_at,
      c.created_at)
    end)`;
}

/**
 * Internal chat (plan phase-2-step-15a, ADR 0022). Access is `visibleConversations`; new, edited
 * and deleted messages go live to the personal rooms of the people who can read the conversation
 * at that moment, computed in the same transaction.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
  ) {}

  list(ctx: TenantContext): Promise<ConversationSummary[]> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const result = await tx.execute<{
        id: string;
        unread: number;
      }>(sql`
        select c.id, (select count(*)::int from messages m where m.conversation_id = c.id and ${unreadCondition(me)}) as unread
        from conversations c
        left join conversation_members mine on mine.conversation_id = c.id and mine.member_id = ${me}
        where ${visibleConversationsRaw(me)}
        order by c.last_message_at desc nulls last, c.created_at desc
        limit 300`);
      const unread = new Map(result.rows.map((r) => [r.id, r.unread]));
      return this.summaries(tx, ctx, [...unread.keys()], unread);
    });
  }

  /** Unread across all conversations except muted ones, in one query (it runs on every hint). */
  unreadCount(ctx: TenantContext): Promise<number> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const result = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count
        from conversations c
        left join conversation_members mine on mine.conversation_id = c.id and mine.member_id = ${me}
        join messages m on m.conversation_id = c.id
        where ${visibleConversationsRaw(me)} and coalesce(mine.muted, false) = false
          and ${unreadCondition(me)}`);
      return result.rows[0]?.count ?? 0;
    });
  }

  get(ctx: TenantContext, id: string): Promise<Conversation> {
    return this.db.run(ctx, async (tx) => {
      const row = await this.requireVisible(tx, ctx, id);
      return this.detail(tx, ctx, row);
    });
  }

  /** The channel of a project or department, if the person is in it. */
  forSource(ctx: TenantContext, kind: 'project' | 'department', sourceId: string) {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.conversations)
        .where(
          and(
            kind === 'project'
              ? eq(s.conversations.projectId, sourceId)
              : eq(s.conversations.departmentId, sourceId),
            visibleConversations(ctx.memberId),
          ),
        );
      if (!row) throw notFound('Conversation');
      const [summary] = await this.summaries(tx, ctx, [row.id]);
      if (!summary) throw notFound('Conversation');
      return summary;
    });
  }

  /** Opens the one conversation with this person, creating it the first time. */
  direct(ctx: TenantContext, memberId: string): Promise<Conversation> {
    return this.db.run(ctx, async (tx) => {
      if (memberId === ctx.memberId) throw badRequest('Not with yourself');
      await this.requireActiveMembers(tx, [memberId]);
      const key = directKey(ctx.memberId, memberId);
      await tx
        .insert(s.conversations)
        .values({ id: uuidv7(), kind: 'direct', directKey: key, createdBy: ctx.memberId })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(s.conversations)
        .where(eq(s.conversations.directKey, key));
      if (!row) throw notFound('Conversation');
      await tx
        .insert(s.conversationMembers)
        .values([
          { conversationId: row.id, memberId: ctx.memberId },
          { conversationId: row.id, memberId },
        ])
        .onConflictDoNothing();
      return this.detail(tx, ctx, row);
    });
  }

  async createGroup(ctx: TenantContext, body: CreateGroupRequest): Promise<Conversation> {
    const { conversation, memberIds } = await this.db.run(ctx, async (tx) => {
      const others = [...new Set(body.memberIds)].filter((m) => m !== ctx.memberId);
      await this.requireActiveMembers(tx, others);
      const [row] = await tx
        .insert(s.conversations)
        .values({ id: uuidv7(), kind: 'group', title: body.title, createdBy: ctx.memberId })
        .returning();
      if (!row) throw notFound('Conversation');
      await tx
        .insert(s.conversationMembers)
        .values([
          { conversationId: row.id, memberId: ctx.memberId, role: 'owner' as const },
          ...others.map((memberId) => ({ conversationId: row.id, memberId })),
        ]);
      return { conversation: await this.detail(tx, ctx, row), memberIds: others };
    });
    await this.hint(ctx.tenantId, memberIds);
    return conversation;
  }

  async rename(ctx: TenantContext, id: string, title: string): Promise<Conversation> {
    const { conversation, members } = await this.db.run(ctx, async (tx) => {
      const row = await this.requireGroup(tx, ctx, id);
      if (!(await this.isOwner(tx, id, ctx.memberId))) throw ownerOnly();
      const [updated] = await tx
        .update(s.conversations)
        .set({ title })
        .where(eq(s.conversations.id, row.id))
        .returning();
      return {
        conversation: await this.detail(tx, ctx, updated ?? row),
        members: await this.activeMemberIds(tx, id),
      };
    });
    await this.hint(ctx.tenantId, members);
    return conversation;
  }

  /** Any member of a group may add people (up to 50 in all). */
  async addMembers(ctx: TenantContext, id: string, memberIds: string[]): Promise<Conversation> {
    const result = await this.db.run(ctx, async (tx) => {
      const row = await this.requireGroup(tx, ctx, id, true);
      const ids = [...new Set(memberIds)];
      await this.requireActiveMembers(tx, ids);
      const current = await this.activeMemberIds(tx, id);
      const fresh = ids.filter((m) => !current.includes(m));
      if (current.length + fresh.length > MAX_GROUP) {
        throw badRequest(`A group has at most ${MAX_GROUP} members`);
      }
      for (const memberId of fresh) {
        await tx
          .insert(s.conversationMembers)
          .values({ conversationId: id, memberId })
          .onConflictDoUpdate({
            target: [
              s.conversationMembers.tenantId,
              s.conversationMembers.conversationId,
              s.conversationMembers.memberId,
            ],
            // Coming back starts fresh: nothing from before counts as unread.
            set: { leftAt: null, joinedAt: new Date(), lastReadMessageId: null, role: 'member' },
          });
      }
      return {
        conversation: await this.detail(tx, ctx, row),
        members: await this.activeMemberIds(tx, id),
      };
    });
    await this.hint(ctx.tenantId, result.members);
    return result.conversation;
  }

  async removeMember(ctx: TenantContext, id: string, memberId: string): Promise<void> {
    const remaining = await this.db.run(ctx, async (tx) => {
      await this.requireGroup(tx, ctx, id, true);
      if (!(await this.isOwner(tx, id, ctx.memberId))) throw ownerOnly();
      if (memberId === ctx.memberId) throw badRequest('Leave the group instead');
      await this.markLeft(tx, id, memberId);
      return this.activeMemberIds(tx, id);
    });
    await this.hint(ctx.tenantId, [memberId, ...remaining]);
  }

  /** Leaving: if the owner leaves, the longest-standing member takes over. */
  async leave(ctx: TenantContext, id: string): Promise<void> {
    const remaining = await this.db.run(ctx, async (tx) => {
      await this.requireGroup(tx, ctx, id, true);
      const wasOwner = await this.isOwner(tx, id, ctx.memberId);
      await this.markLeft(tx, id, ctx.memberId);
      if (wasOwner) await this.handOver(tx, id);
      return this.activeMemberIds(tx, id);
    });
    await this.hint(ctx.tenantId, [ctx.memberId, ...remaining]);
  }

  /** The member who joined first becomes the owner. */
  private async handOver(tx: Tx, id: string): Promise<void> {
    const [next] = await tx
      .select({ memberId: s.conversationMembers.memberId })
      .from(s.conversationMembers)
      .where(
        and(eq(s.conversationMembers.conversationId, id), isNull(s.conversationMembers.leftAt)),
      )
      .orderBy(asc(s.conversationMembers.joinedAt))
      .limit(1);
    if (next) {
      await tx
        .update(s.conversationMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(s.conversationMembers.conversationId, id),
            eq(s.conversationMembers.memberId, next.memberId),
          ),
        );
    }
  }

  setMuted(ctx: TenantContext, id: string, muted: boolean): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      await this.ensureState(tx, id, ctx.memberId);
      await tx
        .update(s.conversationMembers)
        .set({ muted })
        .where(
          and(
            eq(s.conversationMembers.conversationId, id),
            eq(s.conversationMembers.memberId, ctx.memberId),
          ),
        );
    });
  }

  /** Moves the person's read mark forward (never back) and clears their chat notifications. */
  async markRead(ctx: TenantContext, id: string, messageId: string): Promise<void> {
    await this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      const [msg] = await tx
        .select({ id: s.messages.id })
        .from(s.messages)
        .where(and(eq(s.messages.id, messageId), eq(s.messages.conversationId, id)));
      if (!msg) throw notFound('Message');
      await this.ensureState(tx, id, ctx.memberId);
      await tx
        .update(s.conversationMembers)
        .set({ lastReadMessageId: messageId })
        .where(
          and(
            eq(s.conversationMembers.conversationId, id),
            eq(s.conversationMembers.memberId, ctx.memberId),
            sql`(${s.conversationMembers.lastReadMessageId} is null or ${s.conversationMembers.lastReadMessageId} < ${messageId})`,
          ),
        );
      await tx
        .update(s.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(s.notifications.recipientId, ctx.memberId),
            eq(s.notifications.subjectType, 'conversation'),
            eq(s.notifications.subjectId, id),
            isNull(s.notifications.readAt),
          ),
        );
    });
    await this.hint(ctx.tenantId, [ctx.memberId]);
  }

  messages(ctx: TenantContext, id: string, query: ListMessagesQuery): Promise<MessagePage> {
    return this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      const where = and(
        eq(s.messages.conversationId, id),
        query.before ? sql`${s.messages.id} < ${query.before}` : undefined,
        query.after ? sql`${s.messages.id} > ${query.after}` : undefined,
      );
      const rows = await tx
        .select()
        .from(s.messages)
        .where(where)
        .orderBy(query.after ? asc(s.messages.id) : desc(s.messages.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const items = await this.present(tx, query.after ? page : page.reverse());
      return { items, hasMore: rows.length > query.limit };
    });
  }

  async send(ctx: TenantContext, id: string, body: SendMessageRequest): Promise<Message> {
    const { message, audience } = await this.db.run(ctx, async (tx) => {
      const conversation = await this.requireVisible(tx, ctx, id);
      await this.requirePostable(tx, ctx, id);
      if (body.replyToId) {
        const [parent] = await tx
          .select({ id: s.messages.id })
          .from(s.messages)
          .where(and(eq(s.messages.id, body.replyToId), eq(s.messages.conversationId, id)));
        if (!parent) throw notFound('Message');
      }
      const [row] = await tx
        .insert(s.messages)
        .values({
          id: uuidv7(),
          conversationId: id,
          authorId: ctx.memberId,
          body: body.body,
          replyToId: body.replyToId ?? null,
        })
        .returning();
      if (!row) throw notFound('Message');
      await tx
        .update(s.conversations)
        .set({ lastMessageAt: row.createdAt })
        .where(eq(s.conversations.id, id));
      // The author has read what they wrote.
      await this.ensureState(tx, id, ctx.memberId);
      await tx
        .update(s.conversationMembers)
        .set({ lastReadMessageId: row.id })
        .where(
          and(
            eq(s.conversationMembers.conversationId, id),
            eq(s.conversationMembers.memberId, ctx.memberId),
          ),
        );
      await emitEvent(
        tx,
        'message.created',
        { conversationId: id, messageId: row.id, kind: conversation.kind },
        ctx.memberId,
      );
      const [message] = await this.present(tx, [row]);
      return { message: message as Message, audience: await this.audience(tx, id) };
    });
    await this.deliver(ctx.tenantId, audience, message);
    return message;
  }

  async edit(ctx: TenantContext, messageId: string, body: string): Promise<Message> {
    const { message, audience } = await this.db.run(ctx, async (tx) => {
      const row = await this.requireOwnMessage(tx, ctx, messageId);
      const [updated] = await tx
        .update(s.messages)
        .set({ body, editedAt: new Date() })
        .where(and(eq(s.messages.id, messageId), isNull(s.messages.deletedAt)))
        .returning();
      if (!updated) throw notFound('Message');
      const [message] = await this.present(tx, [updated]);
      return { message: message as Message, audience: await this.audience(tx, row.conversationId) };
    });
    await this.deliver(ctx.tenantId, audience, message);
    return message;
  }

  /** Soft delete: the text is gone from the database too, the trace «deleted» stays. */
  async remove(ctx: TenantContext, messageId: string): Promise<void> {
    const { message, audience } = await this.db.run(ctx, async (tx) => {
      const row = await this.requireOwnMessage(tx, ctx, messageId);
      const [updated] = await tx
        .update(s.messages)
        .set({ body: '', deletedAt: new Date() })
        .where(and(eq(s.messages.id, messageId), isNull(s.messages.deletedAt)))
        .returning();
      if (!updated) throw notFound('Message');
      const [message] = await this.present(tx, [updated]);
      return { message: message as Message, audience: await this.audience(tx, row.conversationId) };
    });
    await this.deliver(ctx.tenantId, audience, message);
  }

  // ---------------------------------------------------------------------------------------------

  private async deliver(tenantId: string, audience: string[], message: Message): Promise<void> {
    // The message itself tells clients to refresh lists and counts; no extra hint is needed.
    await this.realtime
      .toMembers(tenantId, audience, CHAT_SOCKET.message, message)
      .catch(() => undefined);
  }

  private hint(tenantId: string, memberIds: string[]): Promise<void> {
    return this.realtime
      .toMembers(tenantId, memberIds, REALTIME_EVENTS.chatChanged)
      .catch(() => undefined);
  }

  private async audience(tx: Tx, conversationId: string): Promise<string[]> {
    const result = await tx.execute<{ id: string }>(audienceOf(conversationId));
    return result.rows.map((r) => r.id);
  }

  private async requireVisible(tx: Tx, ctx: TenantContext, id: string): Promise<ConversationRow> {
    const [row] = await tx
      .select()
      .from(s.conversations)
      .where(and(eq(s.conversations.id, id), visibleConversations(ctx.memberId)));
    if (!row) throw notFound('Conversation');
    return row;
  }

  private async requirePostable(tx: Tx, ctx: TenantContext, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(and(eq(s.conversations.id, id), postableConversations(ctx.memberId)));
    if (!row) throw readOnly();
  }

  private async requireGroup(
    tx: Tx,
    ctx: TenantContext,
    id: string,
    lock = false,
  ): Promise<ConversationRow> {
    const query = tx
      .select()
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.id, id),
          eq(s.conversations.kind, 'group'),
          visibleConversations(ctx.memberId),
        ),
      );
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound('Conversation');
    return row;
  }

  private async requireOwnMessage(tx: Tx, ctx: TenantContext, messageId: string) {
    const [row] = await tx
      .select({ message: s.messages })
      .from(s.messages)
      .innerJoin(s.conversations, eq(s.conversations.id, s.messages.conversationId))
      .where(
        and(
          eq(s.messages.id, messageId),
          isNull(s.messages.deletedAt),
          visibleConversations(ctx.memberId),
        ),
      );
    if (!row) throw notFound('Message');
    if (row.message.authorId !== ctx.memberId) throw notFound('Message');
    if (!canStillEdit(row.message.createdAt)) throw editWindow();
    await this.requirePostable(tx, ctx, row.message.conversationId);
    return row.message;
  }

  private async requireActiveMembers(tx: Tx, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const rows = await tx
      .select({ id: s.members.id })
      .from(s.members)
      .where(and(inArray(s.members.id, ids), eq(s.members.status, 'active')));
    if (rows.length !== new Set(ids).size) throw notFound('Member');
  }

  private async activeMemberIds(tx: Tx, conversationId: string): Promise<string[]> {
    const rows = await tx
      .select({ memberId: s.conversationMembers.memberId })
      .from(s.conversationMembers)
      .where(
        and(
          eq(s.conversationMembers.conversationId, conversationId),
          isNull(s.conversationMembers.leftAt),
        ),
      );
    return rows.map((r) => r.memberId);
  }

  private async isOwner(tx: Tx, conversationId: string, memberId: string): Promise<boolean> {
    const [row] = await tx
      .select({ role: s.conversationMembers.role })
      .from(s.conversationMembers)
      .where(
        and(
          eq(s.conversationMembers.conversationId, conversationId),
          eq(s.conversationMembers.memberId, memberId),
          isNull(s.conversationMembers.leftAt),
        ),
      );
    return row?.role === 'owner';
  }

  private async markLeft(tx: Tx, conversationId: string, memberId: string): Promise<void> {
    const [row] = await tx
      .update(s.conversationMembers)
      .set({ leftAt: new Date(), role: 'member' })
      .where(
        and(
          eq(s.conversationMembers.conversationId, conversationId),
          eq(s.conversationMembers.memberId, memberId),
          isNull(s.conversationMembers.leftAt),
        ),
      )
      .returning({ memberId: s.conversationMembers.memberId });
    if (!row) throw notFound('Member');
  }

  /** A personal state row (read mark, mute); channels get one on first use. */
  private async ensureState(tx: Tx, conversationId: string, memberId: string): Promise<void> {
    await tx
      .insert(s.conversationMembers)
      .values({ conversationId, memberId })
      .onConflictDoNothing();
  }

  private async present(tx: Tx, rows: MessageRow[]): Promise<Message[]> {
    if (!rows.length) return [];
    const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
    const replies = replyIds.length
      ? await tx.select().from(s.messages).where(inArray(s.messages.id, replyIds))
      : [];
    const authorIds = [...new Set([...rows, ...replies].map((r) => r.authorId))];
    const people = await tx
      .select({ id: s.members.id, displayName: s.members.displayName })
      .from(s.members)
      .where(inArray(s.members.id, authorIds));
    const name = new Map(people.map((p) => [p.id, p.displayName]));
    const replyMap = new Map(replies.map((r) => [r.id, r]));
    return rows.map((r) => {
      // A quote is only ever shown from the same conversation (the schema enforces it too).
      const found = r.replyToId ? replyMap.get(r.replyToId) : undefined;
      const reply = found?.conversationId === r.conversationId ? found : undefined;
      return {
        id: r.id,
        conversationId: r.conversationId,
        author: { id: r.authorId, displayName: name.get(r.authorId) ?? '' },
        body: r.deletedAt ? '' : r.body,
        replyTo: reply
          ? {
              id: reply.id,
              author: { id: reply.authorId, displayName: name.get(reply.authorId) ?? '' },
              body: reply.deletedAt ? '' : reply.body.slice(0, 200),
              deleted: Boolean(reply.deletedAt),
            }
          : null,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        deleted: Boolean(r.deletedAt),
      };
    });
  }

  private async summaries(
    tx: Tx,
    ctx: TenantContext,
    ids: string[],
    unread?: Map<string, number>,
  ): Promise<ConversationSummary[]> {
    if (!ids.length) return [];
    const me = ctx.memberId;
    const mine = alias(s.conversationMembers, 'mine');
    const rows = await tx
      .select({
        c: s.conversations,
        projectName: s.projects.name,
        departmentName: s.departments.name,
        muted: mine.muted,
      })
      .from(s.conversations)
      .leftJoin(s.projects, eq(s.projects.id, s.conversations.projectId))
      .leftJoin(s.departments, eq(s.departments.id, s.conversations.departmentId))
      .leftJoin(mine, and(eq(mine.conversationId, s.conversations.id), eq(mine.memberId, me)))
      .where(inArray(s.conversations.id, ids));
    const directIds = rows.filter((r) => r.c.kind === 'direct').map((r) => r.c.id);
    const peers = directIds.length
      ? await tx
          .select({
            conversationId: s.conversationMembers.conversationId,
            id: s.members.id,
            displayName: s.members.displayName,
          })
          .from(s.conversationMembers)
          .innerJoin(s.members, eq(s.members.id, s.conversationMembers.memberId))
          .where(
            and(
              inArray(s.conversationMembers.conversationId, directIds),
              sql`${s.conversationMembers.memberId} <> ${me}`,
            ),
          )
      : [];
    const lastRows = await tx.execute<{
      conversation_id: string;
      author_id: string;
      author_name: string;
      body: string;
      created_at: Date;
      deleted_at: Date | null;
    }>(sql`
      select distinct on (m.conversation_id) m.conversation_id, m.author_id, a.display_name as author_name,
        m.body, m.created_at, m.deleted_at
      from messages m join members a on a.id = m.author_id
      where m.conversation_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      order by m.conversation_id, m.id desc`);
    const last = new Map(lastRows.rows.map((r) => [r.conversation_id, r]));
    let counts = unread;
    if (!counts) {
      const result = await tx.execute<{ id: string; unread: number }>(sql`
        select c.id, (select count(*)::int from messages m where m.conversation_id = c.id and ${unreadCondition(me)}) as unread
        from conversations c
        left join conversation_members mine on mine.conversation_id = c.id and mine.member_id = ${me}
        where c.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
      counts = new Map(result.rows.map((r) => [r.id, r.unread]));
    }
    const byId = new Map(rows.map((r) => [r.c.id, r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      if (!r) return [];
      const peer = peers.find((p) => p.conversationId === id) ?? null;
      const lm = last.get(id);
      const title =
        r.c.kind === 'project'
          ? (r.projectName ?? '')
          : r.c.kind === 'department'
            ? (r.departmentName ?? '')
            : r.c.kind === 'direct'
              ? (peer?.displayName ?? '')
              : (r.c.title ?? '');
      return [
        {
          id,
          kind: r.c.kind,
          title,
          peer: peer ? { id: peer.id, displayName: peer.displayName } : null,
          projectId: r.c.projectId,
          departmentId: r.c.departmentId,
          lastMessage: lm
            ? {
                author: { id: lm.author_id, displayName: lm.author_name },
                body: lm.deleted_at ? '' : lm.body.slice(0, 140),
                createdAt: new Date(lm.created_at).toISOString(),
                deleted: Boolean(lm.deleted_at),
              }
            : null,
          unreadCount: counts.get(id) ?? 0,
          muted: Boolean(r.muted),
        },
      ];
    });
  }

  private async detail(tx: Tx, ctx: TenantContext, row: ConversationRow): Promise<Conversation> {
    const me = ctx.memberId;
    const [summary] = await this.summaries(tx, ctx, [row.id]);
    if (!summary) throw notFound('Conversation');
    let members: ConversationMember[];
    if (row.kind === 'project') {
      const rows = await tx
        .select({
          id: s.members.id,
          displayName: s.members.displayName,
          role: s.projectMembers.role,
        })
        .from(s.projectMembers)
        .innerJoin(s.members, eq(s.members.id, s.projectMembers.memberId))
        .where(
          and(eq(s.projectMembers.projectId, row.projectId ?? ''), eq(s.members.status, 'active')),
        )
        .orderBy(asc(s.members.displayName));
      members = rows.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        canPost: m.role !== 'observer',
        owner: m.role === 'owner',
      }));
    } else if (row.kind === 'department') {
      const rows = await tx
        .select({
          id: s.members.id,
          displayName: s.members.displayName,
          role: s.departmentMemberships.deptRole,
        })
        .from(s.departmentMemberships)
        .innerJoin(s.members, eq(s.members.id, s.departmentMemberships.memberId))
        .where(
          and(
            eq(s.departmentMemberships.departmentId, row.departmentId ?? ''),
            eq(s.members.status, 'active'),
          ),
        )
        .orderBy(asc(s.members.displayName));
      members = rows.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        canPost: m.role !== 'viewer',
        owner: m.role === 'head',
      }));
    } else {
      const rows = await tx
        .select({
          id: s.members.id,
          displayName: s.members.displayName,
          role: s.conversationMembers.role,
        })
        .from(s.conversationMembers)
        .innerJoin(s.members, eq(s.members.id, s.conversationMembers.memberId))
        .where(
          and(
            eq(s.conversationMembers.conversationId, row.id),
            isNull(s.conversationMembers.leftAt),
          ),
        )
        .orderBy(asc(s.conversationMembers.joinedAt));
      members = rows.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        canPost: true,
        owner: m.role === 'owner',
      }));
    }
    const [state] = await tx
      .select({ lastRead: s.conversationMembers.lastReadMessageId })
      .from(s.conversationMembers)
      .where(
        and(
          eq(s.conversationMembers.conversationId, row.id),
          eq(s.conversationMembers.memberId, me),
        ),
      );
    const [postable] = await tx
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(and(eq(s.conversations.id, row.id), postableConversations(me)));
    const group = row.kind === 'group';
    const owner = group && members.some((m) => m.id === me && m.owner);
    return {
      ...summary,
      members,
      lastReadMessageId: state?.lastRead ?? null,
      can: {
        post: Boolean(postable),
        manage: owner,
        addMembers: group,
        leave: group,
      },
    };
  }
}
