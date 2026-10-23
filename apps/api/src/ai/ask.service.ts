import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  asksToJudgePeople,
  calendarDateIn,
  formatCalendarDate,
  KNOWLEDGE_KINDS,
  type AskRequest,
  type AskResponse,
  type KnowledgeIndexStatus,
  type KnowledgeKind,
} from '@madar/shared';
import { sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError } from '../common/errors.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { AiClient } from './ai-client.js';
import { firstMessages, searchKnowledge } from './knowledge-search.js';
import { countDueSources } from './knowledge-sources.js';
import { AiLimiter } from './limiter.js';
import { loadAiSettings } from './settings.js';

/**
 * «از مدار بپرس» (plan phase-3-step-16b, ADR 0026): a question answered from the company's own
 * knowledge, from sources the asking person may see, with numbered citations. The model is asked
 * only when something related was found; questions that rank or judge people are refused.
 */
@Injectable()
export class AskService {
  /** Twenty questions a minute per person, 120 per company. */
  private readonly limiter = new AiLimiter(20, 120);

  constructor(
    private readonly db: TenantDb,
    private readonly client: AiClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async ask(ctx: TenantContext, body: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
    const { timeZone } = await this.db.run(ctx, async (tx) => {
      if (!(await loadAiSettings(tx, ctx.tenantId)).enabled) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'ai_disabled', 'The assistant is off');
      }
      return loadWorkCalendar(tx, ctx.tenantId);
    });
    if (asksToJudgePeople(body.question)) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'ai_refused', 'Judges people');
    }
    if (!this.client.available) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'ai_unavailable', 'No AI service');
    }
    this.limiter.take(ctx.tenantId, ctx.memberId);

    const embedded = await this.client.embed([body.question], signal);
    const vector = embedded.vectors[0] ?? [];
    const { found, anchors } = await this.db.run(ctx, async (tx) => {
      const found = await searchKnowledge(
        tx,
        ctx.actor,
        vector,
        embedded.model,
        this.env.AI_ASK_MAX_DISTANCE,
      );
      const days = found.flatMap((f) =>
        f.kind === 'channel' && f.day ? [{ id: f.id, day: f.day }] : [],
      );
      return { found, anchors: await firstMessages(tx, days, timeZone) };
    });
    if (found.length === 0) return { answer: null, sources: [] };

    const reply = await this.client.answer(
      {
        question: body.question,
        today: formatCalendarDate(calendarDateIn(new Date(), timeZone), 'full'),
        sources: found.map((f, i) => ({ n: i + 1, kind: f.kind, title: f.title, text: f.text })),
      },
      signal,
    );
    const cited = new Set(reply.cited);
    return {
      answer: reply.text,
      sources: found.map((f, i) => ({
        n: i + 1,
        kind: f.kind,
        id: f.id,
        title: f.title,
        day: f.day,
        messageId: f.day ? (anchors.get(`${f.id}:${f.day}`) ?? null) : null,
        cited: cited.has(i + 1),
      })),
    };
  }

  /** Admins' view of the index: what is in it and how much is still waiting. */
  indexStatus(ctx: TenantContext): Promise<KnowledgeIndexStatus> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          kind: s.knowledgeChunks.sourceType,
          sources: sql<number>`count(distinct (${s.knowledgeChunks.sourceId}, ${s.knowledgeChunks.day}))::int`,
          chunks: sql<number>`count(*)::int`,
        })
        .from(s.knowledgeChunks)
        .groupBy(s.knowledgeChunks.sourceType);
      const sources = Object.fromEntries(KNOWLEDGE_KINDS.map((kind) => [kind, 0])) as Record<
        KnowledgeKind,
        number
      >;
      for (const row of rows) sources[row.kind] = row.sources;
      const enabled = (await loadAiSettings(tx, ctx.tenantId)).enabled;
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      return {
        sources,
        chunks: rows.reduce((sum, row) => sum + row.chunks, 0),
        pending: enabled ? await countDueSources(tx, timeZone) : 0,
      };
    });
  }
}
