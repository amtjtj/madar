/**
 * The company knowledge index for «از مدار بپرس» (phase 3, step 16b, ADR 0026): text chunks of
 * tasks, sent letters, meeting minutes and channel messages, with their embeddings (pgvector).
 * One index per company under forced RLS; who may see a chunk is decided at query time by joining
 * the source's own visibility condition, never by this table. Written only by the worker
 * (`knowledge-embed`) and cleared when the company turns the assistant off.
 * Data plane: tenant_id, forced RLS (drizzle/*_knowledge_chunks.sql). Sources are polymorphic, so
 * there is no foreign key to them; a chunk whose source is gone matches no visibility condition.
 */
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

import { id, tenantId } from './columns.js';
import { tenants } from './control.js';

/** Vector size of the embedding model (bge-m3). A model with another size needs a migration. */
export const EMBEDDING_DIMENSIONS = 1024;

export const knowledgeSource = pgEnum('knowledge_source', ['task', 'letter', 'meeting', 'channel']);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    sourceType: knowledgeSource('source_type').notNull(),
    /** Task, letter, meeting or (for `channel`) conversation id. */
    sourceId: uuid('source_id').notNull(),
    /** Company calendar day of a channel's messages; null for the other sources. */
    day: date('day', { mode: 'string' }),
    chunkNo: integer('chunk_no').notNull(),
    title: text('title').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    /** Embedding model; a query only compares vectors of the same model. */
    model: text('model').notNull(),
    /** Hash of the source text: the same text is never embedded twice. */
    contentHash: text('content_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('knowledge_chunks_source_key')
      .on(t.tenantId, t.sourceType, t.sourceId, t.day, t.chunkNo)
      .nullsNotDistinct(),
    // Search is an exact scan of one company's chunks (ADR 0026), so this index is the access path.
    index('knowledge_chunks_tenant_idx').on(t.tenantId, t.model),
  ],
);
