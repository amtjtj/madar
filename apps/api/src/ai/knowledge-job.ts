import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle } from '@madar/db';
import { ne } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { AiClient } from './ai-client.js';
import {
  currentChunks,
  dueSources,
  loadSources,
  removeStaleChunks,
  replaceChunks,
  sourceKey,
  touchChunks,
  type SourceRef,
  type SourceText,
} from './knowledge-sources.js';
import { loadAiSettings } from './settings.js';

/** Sources read per round; a round embeds their changed chunks in calls of at most EMBED_BATCH. */
const ROUND = 24;
const EMBED_BATCH = 64;
/** A run stops starting new rounds after this long, so the next minute's run is not held up. */
const RUN_BUDGET_MS = 40_000;

/**
 * Keeps each company's knowledge index in step with its data (plan phase-3-step-16b, ADR 0026), on
 * the worker's own queue every minute. One mechanism for everything: the first indexing after the
 * assistant is turned on, edits, and removals. Text is read in the tenant's transaction, embedded
 * outside any transaction, then written in a new one that checks the assistant is still on.
 */
@Injectable()
export class KnowledgeIndexJob {
  private readonly logger = new Logger('KnowledgeIndex');
  /** The embedding model the service last reported; chunks of another model are rebuilt. */
  private model: string | undefined;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly client: AiClient,
  ) {}

  async runAll(): Promise<void> {
    if (!this.client.available) return;
    const started = Date.now();
    for (const tenant of await listActiveTenants(this.handle.db)) {
      try {
        await this.runForTenant(tenant.id, started + RUN_BUDGET_MS);
      } catch (error) {
        // AiClient logged what failed; never the content.
        this.logger.error(`tenant ${tenant.id}: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
  }

  /** Returns how many sources were (re)embedded. */
  async runForTenant(tenantId: string, until = Date.now() + RUN_BUDGET_MS): Promise<number> {
    if (!this.client.available) return 0;
    this.model = (await this.client.embedModel()) ?? this.model;
    let embedded = 0;
    do {
      const model = this.model;
      const round = await withTenant(this.handle.db, { tenantId }, async (tx) => {
        if (!(await loadAiSettings(tx, tenantId)).enabled) return null;
        const { timeZone } = await loadWorkCalendar(tx, tenantId);
        await removeStaleChunks(tx, timeZone);
        // A new embedding model: older vectors cannot be compared, so their sources are due again.
        if (model) await tx.delete(s.knowledgeChunks).where(ne(s.knowledgeChunks.model, model));
        const refs = await dueSources(tx, timeZone, ROUND);
        return {
          refs,
          texts: await loadSources(tx, refs, timeZone),
          current: await currentChunks(tx, refs),
        };
      });
      if (!round || round.refs.length === 0) break;

      const touch: SourceRef[] = [];
      const fresh: SourceText[] = [];
      for (const ref of round.refs) {
        const text = round.texts.get(sourceKey(ref));
        if (!text) continue; // Gone since it was listed; removeStaleChunks clears it next round.
        const current = round.current.get(sourceKey(ref));
        const sameModel = this.model === undefined || current?.model === this.model;
        if (current?.hash === text.hash && sameModel) touch.push(ref);
        else fresh.push(text);
      }

      const vectors = new Map<string, number[][]>();
      const texts = fresh.flatMap((source) => source.chunks.map((chunk) => ({ source, chunk })));
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        const reply = await this.client.embed(batch.map((b) => b.chunk));
        this.model = reply.model;
        batch.forEach((b, j) => {
          const key = sourceKey(b.source.ref);
          vectors.set(key, [...(vectors.get(key) ?? []), reply.vectors[j] ?? []]);
        });
      }

      const written = this.model;
      const done = await withTenant(this.handle.db, { tenantId }, async (tx) => {
        if (!(await loadAiSettings(tx, tenantId)).enabled) return false;
        for (const ref of touch) await touchChunks(tx, ref);
        for (const source of fresh) {
          const v = vectors.get(sourceKey(source.ref));
          if (written && v?.length === source.chunks.length) {
            await replaceChunks(tx, source, v, written);
          }
        }
        return true;
      });
      if (!done) break;
      embedded += fresh.length;
      if (round.refs.length < ROUND) break;
    } while (Date.now() < until);
    return embedded;
  }
}
