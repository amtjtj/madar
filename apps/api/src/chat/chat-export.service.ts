import { Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  addDays,
  can,
  mentionIdsIn,
  mentionsAsText,
  zonedInstant,
  type ChatExport,
  type ChatExportQuery,
  type ExportableChannel,
} from '@madar/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';

/** The most messages one export returns (a narrower date range gets the rest). */
const EXPORT_MAX = 20_000;

/**
 * Chat export (plan phase-2-step-15c, ADR 0022): project and department channels only, for people
 * with `chat.export` (owner and admin), who need not be members. Direct and group conversations are
 * never exported (product owner, answer 3). Every export is in the audit log, without text.
 */
@Injectable()
export class ChatExportService {
  constructor(private readonly db: TenantDb) {}

  channels(ctx: TenantContext): Promise<ExportableChannel[]> {
    this.requirePermission(ctx);
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: s.conversations.id,
          kind: s.conversations.kind,
          project: s.projects.name,
          department: s.departments.name,
          messageCount: sql<number>`(select count(*)::int from messages m
            where m.conversation_id = ${s.conversations.id} and m.deleted_at is null)`,
        })
        .from(s.conversations)
        .leftJoin(s.projects, eq(s.projects.id, s.conversations.projectId))
        .leftJoin(s.departments, eq(s.departments.id, s.conversations.departmentId))
        .where(inArray(s.conversations.kind, ['project', 'department']))
        .orderBy(asc(s.conversations.kind), asc(s.conversations.createdAt));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as 'project' | 'department',
        title: r.project ?? r.department ?? '',
        messageCount: r.messageCount,
      }));
    });
  }

  export(ctx: TenantContext, id: string, query: ChatExportQuery): Promise<ChatExport> {
    this.requirePermission(ctx);
    if (query.from && query.to && query.from > query.to) throw badRequest('from is after to');
    return this.db.run(ctx, async (tx) => {
      const [channel] = await tx
        .select({
          id: s.conversations.id,
          kind: s.conversations.kind,
          project: s.projects.name,
          department: s.departments.name,
        })
        .from(s.conversations)
        .leftJoin(s.projects, eq(s.projects.id, s.conversations.projectId))
        .leftJoin(s.departments, eq(s.departments.id, s.conversations.departmentId))
        .where(
          and(eq(s.conversations.id, id), inArray(s.conversations.kind, ['project', 'department'])),
        );
      // A direct or group conversation is "not found", like any conversation one may not reach.
      if (!channel) throw notFound('Conversation');
      const [tenant] = await tx
        .select({ timezone: s.tenants.timezone })
        .from(s.tenants)
        .where(eq(s.tenants.id, ctx.tenantId));
      const tz = tenant?.timezone ?? 'Asia/Tehran';
      const fetched = await tx
        .select({ message: s.messages, author: s.members.displayName })
        .from(s.messages)
        .innerJoin(s.members, eq(s.members.id, s.messages.authorId))
        .where(
          and(
            eq(s.messages.conversationId, id),
            isNull(s.messages.deletedAt),
            query.from
              ? sql`${s.messages.createdAt} >= ${zonedInstant(query.from, '00:00', tz)}`
              : undefined,
            query.to
              ? sql`${s.messages.createdAt} < ${zonedInstant(addDays(query.to, 1), '00:00', tz)}`
              : undefined,
          ),
        )
        .orderBy(asc(s.messages.id))
        .limit(EXPORT_MAX + 1);
      // Never cut silently: the file and the audit entry say so, and a narrower range gets the rest.
      const truncated = fetched.length > EXPORT_MAX;
      const rows = fetched.slice(0, EXPORT_MAX);
      const ids = rows.map((r) => r.message.id);
      const files = ids.length
        ? await tx
            .select({ subjectId: s.attachments.subjectId, fileName: s.attachments.fileName })
            .from(s.attachments)
            .where(
              and(
                eq(s.attachments.subjectType, 'message'),
                inArray(s.attachments.subjectId, ids),
                eq(s.attachments.status, 'ready'),
                isNull(s.attachments.deletedAt),
              ),
            )
            .orderBy(asc(s.attachments.createdAt))
        : [];
      const tokenIds = [...new Set(rows.flatMap((r) => mentionIdsIn(r.message.body)))];
      const people = tokenIds.length
        ? await tx
            .select({ id: s.members.id, displayName: s.members.displayName })
            .from(s.members)
            .where(inArray(s.members.id, tokenIds))
        : [];
      const names = new Map(people.map((p) => [p.id, p.displayName]));
      const filesOf = new Map<string, string[]>();
      for (const f of files) {
        if (!f.subjectId) continue;
        filesOf.set(f.subjectId, [...(filesOf.get(f.subjectId) ?? []), f.fileName]);
      }
      await this.db.audit(tx, ctx, {
        action: 'chat.exported',
        subjectType: 'conversation',
        subjectId: id,
        after: { from: query.from ?? null, to: query.to ?? null, messages: rows.length, truncated },
      });
      return {
        channel: {
          id: channel.id,
          kind: channel.kind as 'project' | 'department',
          title: channel.project ?? channel.department ?? '',
        },
        truncated,
        rows: rows.map(({ message, author }) => ({
          createdAt: message.createdAt.toISOString(),
          author,
          text: mentionsAsText(message.body, names),
          files: filesOf.get(message.id) ?? [],
          edited: Boolean(message.editedAt),
        })),
      };
    });
  }

  private requirePermission(ctx: TenantContext): void {
    if (!can(ctx.actor, 'chat.export')) throw forbidden('Exporting chat needs chat.export');
  }
}
