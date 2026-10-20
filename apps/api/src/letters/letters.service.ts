import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, uuidv7, type Tx } from '@madar/db';
import {
  formatLetterNumber,
  liteTextPreview,
  toJalali,
  toLatinDigits,
  type Letter,
  type LetterList,
  type LetterRecipient,
  type LetterSummary,
  type ListLettersQuery,
  type ReferLetterRequest,
  type SaveLetterRequest,
} from '@madar/shared';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { TenantContext } from '../common/context.js';
import { ApiError, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { attachmentRows, bindUploads, toAttachment } from '../files/attachments-db.js';
import { checkLetterPin } from '../evidence/letter-provider.js';
import { visibleTasks } from '../work/access.js';
import { visibleLetters } from './access.js';

type LetterRow = typeof s.letters.$inferSelect;

const letterSent = () =>
  new ApiError(HttpStatus.CONFLICT, 'letter_sent', 'A sent letter cannot be changed');
const noRecipients = () =>
  new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'letter_no_recipients',
    'Subject and a recipient are required',
  );
const alreadyRecipient = () =>
  new ApiError(HttpStatus.CONFLICT, 'already_recipient', 'Already has the letter');

/** `before` is «sort time_id» of the last row, so ties keep their order across pages. */
function parseLetterCursor(value: string): { at: string; id: string } {
  const at = value.slice(0, value.lastIndexOf('_'));
  const id = value.slice(value.lastIndexOf('_') + 1);
  return { at, id };
}

/** How many «to» names a summary carries (the sent folder shows them). */
const SUMMARY_TO = 3;

/** `%` and `_` typed by a person are literal characters, not patterns. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Internal letters (plan phase-2-step-12a, ADR 0020): drafts, sending with a gap-free number,
 * folders, read state, replies in a thread, referral and per-person archive.
 */
@Injectable()
export class LettersService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, query: ListLettersQuery): Promise<LetterList> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const mine = alias(s.letterRecipients, 'mine');
      // When it reached the person: a referral arrives after the letter was sent.
      const arrivedAt = sql<Date>`greatest(${s.letters.sentAt}, ${mine.createdAt})`;
      let sortAt: SQL<Date>;
      let where: SQL | undefined;
      switch (query.folder) {
        case 'inbox':
          sortAt = arrivedAt;
          where = and(
            sql`${mine.id} is not null`,
            sql`${s.letters.sentAt} is not null`,
            isNull(mine.archivedAt),
          );
          break;
        case 'sent':
          sortAt = sql<Date>`${s.letters.sentAt}`;
          where = and(
            eq(s.letters.senderId, me),
            sql`${s.letters.sentAt} is not null`,
            isNull(s.letters.senderArchivedAt),
          );
          break;
        case 'drafts':
          sortAt = sql<Date>`${s.letters.updatedAt}`;
          where = and(eq(s.letters.senderId, me), isNull(s.letters.sentAt));
          break;
        case 'archive':
          sortAt = sql<Date>`coalesce(${arrivedAt}, ${s.letters.sentAt})`;
          where = and(
            sql`${s.letters.sentAt} is not null`,
            sql`((${s.letters.senderId} = ${me} and ${s.letters.senderArchivedAt} is not null) or ${mine.archivedAt} is not null)`,
          );
          break;
      }
      const q = query.q ?? '';
      const cursor = query.before ? parseLetterCursor(query.before) : null;
      const rows = await tx
        .select({
          letter: s.letters,
          mine,
          // Microseconds kept, so the cursor never skips letters that arrived in the same ms.
          sortAt: sql<string>`to_char((${sortAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(s.letters)
        .leftJoin(mine, and(eq(mine.letterId, s.letters.id), eq(mine.memberId, me)))
        .where(
          and(
            isNull(s.letters.deletedAt),
            visibleLetters(me),
            where,
            q
              ? // Subjects keep the digits people typed (often Persian); numbers are stored in Latin.
                sql`(${s.letters.subject} ilike ${likePattern(q)} or ${s.letters.subject} ilike ${likePattern(toLatinDigits(q))} or ${s.letters.number} ilike ${likePattern(toLatinDigits(q))})`
              : undefined,
            cursor
              ? sql`((${sortAt}), ${s.letters.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(sortAt), desc(s.letters.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const items = await this.summaries(
        tx,
        ctx,
        page.map((r) => ({ letter: r.letter, mine: r.mine })),
      );
      const last = page.at(-1);
      return {
        items,
        nextBefore: rows.length > query.limit && last ? `${last.sortAt}_${last.letter.id}` : null,
      };
    });
  }

  /** Letters in the person's inbox they have not opened. */
  unreadCount(ctx: TenantContext): Promise<number> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.letterRecipients)
        .innerJoin(s.letters, eq(s.letters.id, s.letterRecipients.letterId))
        .where(
          and(
            eq(s.letterRecipients.memberId, ctx.memberId),
            isNull(s.letterRecipients.readAt),
            isNull(s.letterRecipients.archivedAt),
            sql`${s.letters.sentAt} is not null`,
          ),
        );
      return row?.n ?? 0;
    });
  }

  /** Opens a letter; the first open by a recipient marks it read (and is audited if confidential). */
  get(ctx: TenantContext, id: string): Promise<Letter> {
    return this.db.run(ctx, async (tx) => {
      const letter = await this.requireVisible(tx, ctx, id);
      if (letter.sentAt) {
        const [opened] = await tx
          .update(s.letterRecipients)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(s.letterRecipients.letterId, id),
              eq(s.letterRecipients.memberId, ctx.memberId),
              isNull(s.letterRecipients.readAt),
            ),
          )
          .returning({ id: s.letterRecipients.id });
        if (opened) {
          if (letter.confidential) {
            await this.db.audit(tx, ctx, {
              action: 'letter.confidential_opened',
              subjectType: 'letter',
              subjectId: id,
              after: { number: letter.number },
            });
          }
          await emitEvent(tx, 'letter.read', { letterId: id }, ctx.memberId);
        }
      }
      return this.detail(tx, ctx, letter);
    });
  }

  create(ctx: TenantContext, body: SaveLetterRequest): Promise<Letter> {
    return this.db.run(ctx, async (tx) => {
      const id = uuidv7();
      let threadId = id;
      if (body.replyToId) {
        const parent = await this.requireVisible(tx, ctx, body.replyToId);
        if (!parent.sentAt) throw notFound('Letter');
        threadId = parent.threadId;
      }
      const [letter] = await tx
        .insert(s.letters)
        .values({
          id,
          subject: body.subject,
          body: body.body,
          senderId: ctx.memberId,
          urgency: body.urgency,
          confidential: body.confidential,
          threadId,
          replyToId: body.replyToId ?? null,
        })
        .returning();
      if (!letter) throw notFound('Letter');
      await this.setRecipients(tx, ctx, id, body);
      await bindUploads(tx, ctx, body.uploadIds, { type: 'letter', id });
      return this.detail(tx, ctx, letter);
    });
  }

  /** Edits a draft: its fields and recipients are replaced, new uploads are added. */
  update(ctx: TenantContext, id: string, body: SaveLetterRequest): Promise<Letter> {
    return this.db.run(ctx, async (tx) => {
      // Locked: a send running at the same time finishes first, and then this is refused.
      await this.requireDraft(tx, ctx, id, true);
      const [letter] = await tx
        .update(s.letters)
        .set({
          subject: body.subject,
          body: body.body,
          urgency: body.urgency,
          confidential: body.confidential,
          updatedAt: new Date(),
        })
        .where(and(eq(s.letters.id, id), isNull(s.letters.sentAt)))
        .returning();
      if (!letter) throw notFound('Letter');
      await tx.delete(s.letterRecipients).where(eq(s.letterRecipients.letterId, id));
      await this.setRecipients(tx, ctx, id, body);
      await bindUploads(tx, ctx, body.uploadIds, { type: 'letter', id });
      return this.detail(tx, ctx, letter);
    });
  }

  /** Deletes a draft (soft); its files go with the daily cleanup. */
  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await this.requireDraft(tx, ctx, id, true);
      await tx
        .update(s.letters)
        .set({ deletedAt: new Date() })
        .where(and(eq(s.letters.id, id), isNull(s.letters.sentAt)));
    });
  }

  /**
   * Sends a draft: the next number of the company's Jalali year comes from `letter_counters` in
   * this transaction (the upsert locks the row), so a failed send uses no number.
   */
  send(ctx: TenantContext, id: string): Promise<Letter> {
    return this.db.run(ctx, async (tx) => {
      const draft = await this.requireDraft(tx, ctx, id, true);
      // Someone deactivated since the draft was saved is taken off it, so the list matches who
      // was notified and audited.
      await tx
        .delete(s.letterRecipients)
        .where(
          and(
            eq(s.letterRecipients.letterId, id),
            sql`${s.letterRecipients.memberId} in (select m.id from members m where m.status <> 'active')`,
          ),
        );
      const recipients = await tx
        .select({ memberId: s.letterRecipients.memberId, kind: s.letterRecipients.kind })
        .from(s.letterRecipients)
        .innerJoin(s.members, eq(s.members.id, s.letterRecipients.memberId))
        .where(and(eq(s.letterRecipients.letterId, id), eq(s.members.status, 'active')));
      if (!draft.subject.trim() || !recipients.some((r) => r.kind === 'to')) throw noRecipients();

      const now = new Date();
      const [tenant] = await tx
        .select({ timezone: s.tenants.timezone })
        .from(s.tenants)
        .where(eq(s.tenants.id, ctx.tenantId));
      const year = toJalali(now, tenant?.timezone).jy;
      const [counter] = await tx
        .insert(s.letterCounters)
        .values({ jalaliYear: year, lastNumber: 1 })
        .onConflictDoUpdate({
          target: [s.letterCounters.tenantId, s.letterCounters.jalaliYear],
          set: { lastNumber: sql`${s.letterCounters.lastNumber} + 1` },
        })
        .returning({ lastNumber: s.letterCounters.lastNumber });
      if (!counter) throw notFound('Letter');
      const number = formatLetterNumber(year, counter.lastNumber);
      const [letter] = await tx
        .update(s.letters)
        .set({
          number,
          jalaliYear: year,
          sequence: counter.lastNumber,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(s.letters.id, id))
        .returning();
      if (!letter) throw notFound('Letter');
      await emitEvent(tx, 'letter.sent', { letterId: id }, ctx.memberId);
      await this.db.audit(tx, ctx, {
        action: 'letter.sent',
        subjectType: 'letter',
        subjectId: id,
        after: { number, recipients: recipients.length, confidential: letter.confidential },
      });
      return this.detail(tx, ctx, letter);
    });
  }

  /** Refers a sent letter to colleagues with a note; they see this letter, not its thread. */
  refer(ctx: TenantContext, id: string, body: ReferLetterRequest): Promise<Letter> {
    return this.db.run(ctx, async (tx) => {
      // Locked: two people referring the same colleague at once get «already_recipient», not 500.
      const letter = await this.requireVisible(tx, ctx, id, true);
      if (!letter.sentAt) throw notFound('Letter');
      const memberIds = [...new Set(body.memberIds)];
      const active = await this.activeMembers(tx, memberIds);
      if (active.length !== memberIds.length) throw notFound('Member');
      const existing = await tx
        .select({ memberId: s.letterRecipients.memberId })
        .from(s.letterRecipients)
        .where(
          and(eq(s.letterRecipients.letterId, id), inArray(s.letterRecipients.memberId, memberIds)),
        );
      if (existing.length > 0 || memberIds.includes(letter.senderId)) throw alreadyRecipient();
      await tx.insert(s.letterRecipients).values(
        memberIds.map((memberId) => ({
          letterId: id,
          memberId,
          kind: 'referral' as const,
          referredBy: ctx.memberId,
          referralNote: body.note || null,
        })),
      );
      await emitEvent(tx, 'letter.referred', { letterId: id, memberIds }, ctx.memberId);
      await this.db.audit(tx, ctx, {
        action: 'letter.referred',
        subjectType: 'letter',
        subjectId: id,
        after: { number: letter.number, memberIds, confidential: letter.confidential },
      });
      return this.detail(tx, ctx, letter);
    });
  }

  /** Archives (or brings back) the letter for this person only. */
  setArchived(ctx: TenantContext, id: string, archived: boolean): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const letter = await this.requireVisible(tx, ctx, id);
      if (!letter.sentAt) throw notFound('Letter');
      const at = archived ? new Date() : null;
      if (letter.senderId === ctx.memberId) {
        await tx.update(s.letters).set({ senderArchivedAt: at }).where(eq(s.letters.id, id));
      }
      await tx
        .update(s.letterRecipients)
        .set({ archivedAt: at })
        .where(
          and(eq(s.letterRecipients.letterId, id), eq(s.letterRecipients.memberId, ctx.memberId)),
        );
    });
  }

  /** A letter the person may open, or 404 (also for another company's letters, via RLS). */
  async requireVisible(tx: Tx, ctx: TenantContext, id: string, lock = false): Promise<LetterRow> {
    const query = tx
      .select()
      .from(s.letters)
      .where(and(eq(s.letters.id, id), isNull(s.letters.deletedAt), visibleLetters(ctx.memberId)));
    const [letter] = lock ? await query.for('update') : await query;
    if (!letter) throw notFound('Letter');
    return letter;
  }

  private async requireDraft(
    tx: Tx,
    ctx: TenantContext,
    id: string,
    lock = false,
  ): Promise<LetterRow> {
    const query = tx
      .select()
      .from(s.letters)
      .where(
        and(
          eq(s.letters.id, id),
          eq(s.letters.senderId, ctx.memberId),
          isNull(s.letters.deletedAt),
        ),
      );
    const [letter] = lock ? await query.for('update') : await query;
    if (!letter) throw notFound('Letter');
    if (letter.sentAt) throw letterSent();
    return letter;
  }

  private activeMembers(tx: Tx, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return tx
      .select({ id: s.members.id })
      .from(s.members)
      .where(and(inArray(s.members.id, ids), eq(s.members.status, 'active')));
  }

  /** «to» wins over «cc»; the sender is never their own recipient. */
  private async setRecipients(
    tx: Tx,
    ctx: TenantContext,
    letterId: string,
    body: Pick<SaveLetterRequest, 'to' | 'cc'>,
  ): Promise<void> {
    const to = [...new Set(body.to)].filter((m) => m !== ctx.memberId);
    const cc = [...new Set(body.cc)].filter((m) => m !== ctx.memberId && !to.includes(m));
    const all = [...to, ...cc];
    if (all.length > 50) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'At most 50 recipients');
    }
    const active = await this.activeMembers(tx, all);
    if (active.length !== all.length) throw notFound('Member');
    if (all.length === 0) return;
    await tx
      .insert(s.letterRecipients)
      .values([
        ...to.map((memberId) => ({ letterId, memberId, kind: 'to' as const })),
        ...cc.map((memberId) => ({ letterId, memberId, kind: 'cc' as const })),
      ]);
  }

  private async summaries(
    tx: Tx,
    ctx: TenantContext,
    rows: Array<{ letter: LetterRow; mine: typeof s.letterRecipients.$inferSelect | null }>,
  ): Promise<LetterSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.letter.id);
    const senderIds = [...new Set(rows.map((r) => r.letter.senderId))];
    const [senders, recipients, files] = await Promise.all([
      tx
        .select({ id: s.members.id, displayName: s.members.displayName })
        .from(s.members)
        .where(inArray(s.members.id, senderIds)),
      tx
        .select({
          letterId: s.letterRecipients.letterId,
          id: s.members.id,
          displayName: s.members.displayName,
        })
        .from(s.letterRecipients)
        .innerJoin(s.members, eq(s.members.id, s.letterRecipients.memberId))
        .where(and(inArray(s.letterRecipients.letterId, ids), eq(s.letterRecipients.kind, 'to')))
        .orderBy(asc(s.letterRecipients.createdAt), asc(s.letterRecipients.id)),
      tx
        .select({ subjectId: s.attachments.subjectId, n: sql<number>`count(*)::int` })
        .from(s.attachments)
        .where(
          and(
            eq(s.attachments.subjectType, 'letter'),
            inArray(s.attachments.subjectId, ids),
            eq(s.attachments.status, 'ready'),
            isNull(s.attachments.deletedAt),
          ),
        )
        .groupBy(s.attachments.subjectId),
    ]);
    const names = new Map(senders.map((m) => [m.id, m.displayName]));
    const counts = new Map(files.map((f) => [f.subjectId, f.n]));
    return rows.map(({ letter, mine }) => {
      const isSender = letter.senderId === ctx.memberId;
      return {
        id: letter.id,
        number: letter.number,
        subject: letter.subject,
        preview: liteTextPreview(letter.body.text),
        sender: { id: letter.senderId, displayName: names.get(letter.senderId) ?? '' },
        to: recipients
          .filter((r) => r.letterId === letter.id)
          .slice(0, SUMMARY_TO)
          .map((r) => ({ id: r.id, displayName: r.displayName })),
        urgency: letter.urgency,
        confidential: letter.confidential,
        sentAt: letter.sentAt?.toISOString() ?? null,
        updatedAt: letter.updatedAt.toISOString(),
        attachmentCount: counts.get(letter.id) ?? 0,
        receivedAs: isSender ? null : (mine?.kind ?? null),
        read: isSender || Boolean(mine?.readAt),
      };
    });
  }

  private async detail(tx: Tx, ctx: TenantContext, letter: LetterRow): Promise<Letter> {
    const me = ctx.memberId;
    const isSender = letter.senderId === me;
    const referrer = alias(s.members, 'referrer');
    const [people, files, threadRows] = await Promise.all([
      tx
        .select({
          row: s.letterRecipients,
          displayName: s.members.displayName,
          referrerName: referrer.displayName,
        })
        .from(s.letterRecipients)
        .innerJoin(s.members, eq(s.members.id, s.letterRecipients.memberId))
        .leftJoin(referrer, eq(referrer.id, s.letterRecipients.referredBy))
        .where(eq(s.letterRecipients.letterId, letter.id))
        .orderBy(asc(s.letterRecipients.createdAt), asc(s.letterRecipients.id)),
      attachmentRows(
        tx,
        and(eq(s.attachments.subjectType, 'letter'), eq(s.attachments.subjectId, letter.id)),
      ),
      letter.sentAt
        ? tx
            .select({ letter: s.letters })
            .from(s.letters)
            .where(
              and(
                eq(s.letters.threadId, letter.threadId),
                sql`${s.letters.id} <> ${letter.id}`,
                sql`${s.letters.sentAt} is not null`,
                isNull(s.letters.deletedAt),
                visibleLetters(me),
              ),
            )
            .orderBy(asc(s.letters.sentAt))
        : Promise.resolve([]),
    ]);
    const mine = people.find((p) => p.row.memberId === me)?.row ?? null;
    const recipients: LetterRecipient[] = people.map(({ row, displayName, referrerName }) => ({
      id: row.memberId,
      displayName,
      kind: row.kind,
      // Read state only for the sender and for whoever referred this person (ADR 0020).
      ...(isSender || row.referredBy === me || row.memberId === me
        ? { readAt: row.readAt?.toISOString() ?? null }
        : {}),
      referredBy: row.referredBy ? { id: row.referredBy, displayName: referrerName ?? '' } : null,
      referralNote: row.referralNote,
      referredAt: row.kind === 'referral' ? row.createdAt.toISOString() : null,
    }));
    const threadMine = await this.myRows(
      tx,
      me,
      threadRows.map((t) => t.letter.id),
    );
    const thread = await this.summaries(
      tx,
      ctx,
      threadRows.map((t) => ({ letter: t.letter, mine: threadMine.get(t.letter.id) ?? null })),
    );
    const [summary] = await this.summaries(tx, ctx, [{ letter, mine }]);
    if (!summary) throw notFound('Letter');
    const sent = Boolean(letter.sentAt);
    const draft = !sent && isSender;
    return {
      ...summary,
      body: letter.body,
      recipients,
      attachments: files.map(({ row, uploaderName }) =>
        toAttachment(row, uploaderName, draft && row.uploadedBy === me),
      ),
      threadId: letter.threadId,
      replyToId: letter.replyToId,
      thread,
      archived: isSender ? Boolean(letter.senderArchivedAt) : Boolean(mine?.archivedAt),
      pinnedTo: sent
        ? await tx
            .select({
              evidenceId: s.taskEvidence.id,
              taskId: s.tasks.id,
              title: s.tasks.title,
            })
            .from(s.taskEvidence)
            .innerJoin(s.tasks, eq(s.tasks.id, s.taskEvidence.taskId))
            .where(
              and(
                eq(s.taskEvidence.kind, 'letter'),
                eq(s.taskEvidence.subjectId, letter.id),
                isNull(s.taskEvidence.unpinnedAt),
                isNull(s.tasks.deletedAt),
                visibleTasks(ctx.actor),
              ),
            )
            .orderBy(asc(s.taskEvidence.createdAt))
        : [],
      // The sender learns that their letter is shown elsewhere, without learning where.
      pinnedElsewhere:
        sent && isSender
          ? ((
              await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(s.taskEvidence)
                .innerJoin(s.tasks, eq(s.tasks.id, s.taskEvidence.taskId))
                .where(
                  and(
                    eq(s.taskEvidence.kind, 'letter'),
                    eq(s.taskEvidence.subjectId, letter.id),
                    isNull(s.taskEvidence.unpinnedAt),
                    isNull(s.tasks.deletedAt),
                    sql`not coalesce(${visibleTasks(ctx.actor)}, false)`,
                  ),
                )
            )[0]?.n ?? 0)
          : 0,
      // Confidential letters, and letters of a confidential thread, are never pinned (ADR 0021).
      can: {
        edit: draft,
        refer: sent,
        reply: sent,
        pin: sent && (await checkLetterPin(tx, me, letter.id)) === 'ok',
      },
    };
  }

  private async myRows(tx: Tx, memberId: string, letterIds: string[]) {
    if (letterIds.length === 0) return new Map<string, typeof s.letterRecipients.$inferSelect>();
    const rows = await tx
      .select()
      .from(s.letterRecipients)
      .where(
        and(
          inArray(s.letterRecipients.letterId, letterIds),
          eq(s.letterRecipients.memberId, memberId),
        ),
      );
    return new Map(rows.map((r) => [r.letterId, r]));
  }
}
