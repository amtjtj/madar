import { HttpStatus, Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  calendarDateIn,
  formatCalendarDate,
  type LetterReplyDraftRequest,
  type LetterReplyDraftResponse,
  type MinutesDraftRequest,
  type MinutesDraftResponse,
} from '@madar/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { visibleLetters } from '../letters/access.js';
import { takesPart, visibleMeetings } from '../meetings/access.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { AiClient } from './ai-client.js';
import { AiLimiter } from './limiter.js';
import { loadAiSettings } from './settings.js';

/** Earlier letters of a thread sent with a reply draft, and how much of each. */
const THREAD_MAX = 2;
const THREAD_BODY_MAX = 3000;
const BODY_MAX = 8000;

const plain = (text: string, max: number): string => text.replace(/\*\*/g, '').trim().slice(0, max);

/**
 * The manager's assistant (plan phase-3-step-16c, ADR 0025): drafts only. Minutes are saved with
 * `PUT /api/meetings/:id/minutes`, decisions with `POST …/decisions`, replies through the letter
 * composer; nothing here writes. Each input is built from what the asking person may see.
 */
@Injectable()
export class DraftsService {
  /** Same limits as «جمله به کار»: ten a minute per person, sixty per company. */
  private readonly limiter = new AiLimiter(10, 60);

  constructor(
    private readonly db: TenantDb,
    private readonly client: AiClient,
  ) {}

  private ready(ctx: TenantContext): void {
    if (!this.client.available) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'ai_unavailable', 'No AI service');
    }
    this.limiter.take(ctx.tenantId, ctx.memberId);
  }

  private static off(): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, 'ai_disabled', 'The assistant is off');
  }

  /** «مرتب کن با دستیار»: the writer's notes and the meeting's facts; no participant names. */
  async minutes(
    ctx: TenantContext,
    body: MinutesDraftRequest,
    signal?: AbortSignal,
  ): Promise<MinutesDraftResponse> {
    const input = await this.db.run(ctx, async (tx) => {
      if (!(await loadAiSettings(tx, ctx.tenantId)).enabled) throw DraftsService.off();
      const [meeting] = await tx
        .select({
          title: s.meetings.title,
          type: s.meetings.type,
          startsAt: s.meetings.startsAt,
          agenda: s.meetings.agenda,
          canceledAt: s.meetings.canceledAt,
        })
        .from(s.meetings)
        .where(and(eq(s.meetings.id, body.meetingId), visibleMeetings(ctx.actor)));
      if (!meeting) throw notFound('Meeting');
      // Whoever writes the minutes (ADR 0023); oversight that only reads does not.
      const [writer] = await tx
        .select({ id: s.meetings.id })
        .from(s.meetings)
        .where(and(eq(s.meetings.id, body.meetingId), takesPart(ctx.memberId)));
      if (!writer) throw forbidden();
      if (meeting.canceledAt) {
        throw new ApiError(HttpStatus.CONFLICT, 'meeting_canceled', 'A canceled meeting');
      }
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      return {
        title: meeting.title.slice(0, 200),
        kind: meeting.type,
        date: formatCalendarDate(calendarDateIn(meeting.startsAt, timeZone), 'full'),
        agenda: plain(meeting.agenda, 4000),
        notes: body.notes,
      };
    });
    this.ready(ctx);
    const reply = await this.client.minutes(input, signal);
    return { text: reply.text, decisions: reply.decisions.slice(0, 6) };
  }

  /** «پیش‌نویس پاسخ با دستیار»: a sent letter I may see, never a confidential one. */
  async letterReply(
    ctx: TenantContext,
    body: LetterReplyDraftRequest,
    signal?: AbortSignal,
  ): Promise<LetterReplyDraftResponse> {
    const input = await this.db.run(ctx, async (tx) => {
      if (!(await loadAiSettings(tx, ctx.tenantId)).enabled) throw DraftsService.off();
      const columns = {
        id: s.letters.id,
        subject: s.letters.subject,
        body: s.letters.body,
        senderId: s.letters.senderId,
        replyToId: s.letters.replyToId,
        confidential: s.letters.confidential,
      };
      const [letter] = await tx
        .select(columns)
        .from(s.letters)
        .where(
          and(
            eq(s.letters.id, body.letterId),
            isNotNull(s.letters.sentAt),
            visibleLetters(ctx.memberId),
          ),
        );
      if (!letter) throw notFound('Letter');
      if (letter.confidential) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'ai_not_for_confidential', 'Confidential letter');
      }
      // The letters it answers, newest first, only those I may see and none confidential.
      const thread: Array<{ senderId: string; subject: string; body: string }> = [];
      let parentId = letter.replyToId;
      while (parentId && thread.length < THREAD_MAX) {
        const [parent] = await tx
          .select(columns)
          .from(s.letters)
          .where(
            and(
              eq(s.letters.id, parentId),
              isNotNull(s.letters.sentAt),
              visibleLetters(ctx.memberId),
            ),
          );
        if (!parent || parent.confidential) break;
        thread.push({
          senderId: parent.senderId,
          subject: parent.subject,
          body: plain(parent.body.text, THREAD_BODY_MAX),
        });
        parentId = parent.replyToId;
      }
      // Writing a follow-up to my own letter: the reply speaks to its first «to» recipient.
      let recipientId = ctx.memberId;
      if (letter.senderId === ctx.memberId) {
        const [first] = await tx
          .select({ memberId: s.letterRecipients.memberId })
          .from(s.letterRecipients)
          .where(and(eq(s.letterRecipients.letterId, letter.id), eq(s.letterRecipients.kind, 'to')))
          .orderBy(s.letterRecipients.id)
          .limit(1);
        if (first) recipientId = first.memberId;
      }
      const ids = [letter.senderId, recipientId, ...thread.map((t) => t.senderId)];
      const names = new Map(
        (
          await tx
            .select({ id: s.members.id, name: s.members.displayName })
            .from(s.members)
            .where(inArray(s.members.id, ids))
        ).map((m) => [m.id, m.name] as const),
      );
      const name = (id: string) => (names.get(id) ?? '-').slice(0, 200);
      return {
        subject: letter.subject.slice(0, 200),
        body: plain(letter.body.text, BODY_MAX) || '-',
        sender: name(letter.senderId),
        recipient: name(recipientId),
        thread: thread.reverse().map((t) => ({
          sender: name(t.senderId),
          subject: t.subject.slice(0, 200),
          body: t.body || '-',
        })),
        intent: body.intent,
      };
    });
    this.ready(ctx);
    const reply = await this.client.letterReply(input, signal);
    return { text: reply.text };
  }
}
