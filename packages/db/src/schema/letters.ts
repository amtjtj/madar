/**
 * Internal letters (phase 2, step 12a; ADR 0020). A letter is a draft until it is sent; sending
 * gives it the company's next number for the Jalali year. Only the sender and the people on
 * `letter_recipients` (once sent) can see it, whatever their role.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId, updatedAt } from './columns.js';
import { tenants } from './control.js';
import { members } from './org.js';

export const letterUrgency = pgEnum('letter_urgency', ['normal', 'urgent', 'immediate']);
export const letterRecipientKind = pgEnum('letter_recipient_kind', ['to', 'cc', 'referral']);

export interface LetterBodyJson {
  format: 'lite';
  text: string;
}

export const letters = pgTable(
  'letters',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** «۱۴۰۵/۰۰۰۴۲» in Latin digits; null while a draft. */
    number: text('number'),
    jalaliYear: smallint('jalali_year'),
    sequence: integer('sequence'),
    subject: text('subject').notNull(),
    body: jsonb('body').$type<LetterBodyJson>().notNull(),
    senderId: uuid('sender_id').notNull(),
    urgency: letterUrgency('urgency').notNull().default('normal'),
    confidential: boolean('confidential').notNull().default(false),
    /** The first letter of the conversation (itself for a new letter). */
    threadId: uuid('thread_id').notNull(),
    replyToId: uuid('reply_to_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    senderArchivedAt: timestamp('sender_archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Drafts only; a sent letter is never deleted. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('letters_tenant_id_id_key').on(t.tenantId, t.id),
    unique('letters_tenant_number_key').on(t.tenantId, t.number),
    unique('letters_tenant_year_sequence_key').on(t.tenantId, t.jalaliYear, t.sequence),
    index('letters_tenant_sender_idx').on(t.tenantId, t.senderId, t.sentAt),
    index('letters_tenant_thread_idx').on(t.tenantId, t.threadId),
    check(
      'letters_number_when_sent',
      sql`(${t.sentAt} is null) = (${t.number} is null) and (${t.number} is null) = (${t.sequence} is null) and (${t.number} is null) = (${t.jalaliYear} is null)`,
    ),
    check('letters_draft_deleted_only', sql`${t.deletedAt} is null or ${t.sentAt} is null`),
    foreignKey({
      name: 'letters_sender_fk',
      columns: [t.tenantId, t.senderId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'letters_thread_fk',
      columns: [t.tenantId, t.threadId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'letters_reply_to_fk',
      columns: [t.tenantId, t.replyToId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
  ],
);

export const letterRecipients = pgTable(
  'letter_recipients',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    letterId: uuid('letter_id').notNull(),
    memberId: uuid('member_id').notNull(),
    kind: letterRecipientKind('kind').notNull(),
    /** For a referral: who referred, with an optional note. */
    referredBy: uuid('referred_by'),
    referralNote: text('referral_note'),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('letter_recipients_letter_member_key').on(t.tenantId, t.letterId, t.memberId),
    index('letter_recipients_inbox_idx').on(t.tenantId, t.memberId, t.archivedAt, t.createdAt),
    check(
      'letter_recipients_referral',
      sql`(${t.kind} = 'referral') = (${t.referredBy} is not null)`,
    ),
    foreignKey({
      name: 'letter_recipients_letter_fk',
      columns: [t.tenantId, t.letterId],
      foreignColumns: [letters.tenantId, letters.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'letter_recipients_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'letter_recipients_referred_by_fk',
      columns: [t.tenantId, t.referredBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** The last number handed out per company and Jalali year (locked while sending, so no gaps). */
export const letterCounters = pgTable(
  'letter_counters',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    jalaliYear: smallint('jalali_year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.jalaliYear] })],
);
