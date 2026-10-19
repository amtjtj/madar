import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, recordActivity, schema as s, type Tx } from '@madar/db';
import type {
  Evidence,
  EvidenceAudience,
  EvidenceDetail,
  LetterSummary,
  PinEvidenceRequest,
} from '@madar/shared';
import { liteTextPreview } from '@madar/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { visibleLetters } from '../letters/access.js';
import { canEditTask } from '../work/access.js';
import { TasksService } from '../work/tasks.service.js';
import { checkLetterPin, letterBodyOf, letterSummaries } from './letter-provider.js';

type EvidenceRow = typeof s.taskEvidence.$inferSelect;

const notAllowed = () =>
  new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'evidence_not_allowed',
    'Drafts and confidential letters cannot be pinned',
  );
const alreadyPinned = () =>
  new ApiError(HttpStatus.CONFLICT, 'already_pinned', 'Already pinned to this task');

/** `%` and `_` typed by a person are literal characters. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * «شاهد کار» (plan phase-2-step-12b, ADR 0021). Pinning needs both the item (its provider decides)
 * and edit rights on the task. Seeing a pin needs only the task: this is the one place where
 * seeing one thing follows from seeing another, so it is shown before pinning and audited.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly db: TenantDb,
    private readonly tasks: TasksService,
  ) {}

  list(ctx: TenantContext, taskId: string): Promise<Evidence[]> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.tasks.requireVisible(tx, ctx, taskId);
      const rows = await tx
        .select()
        .from(s.taskEvidence)
        .where(and(eq(s.taskEvidence.taskId, taskId), isNull(s.taskEvidence.unpinnedAt)))
        .orderBy(desc(s.taskEvidence.createdAt));
      return this.present(tx, ctx, task, rows);
    });
  }

  /** Who will see a pinned item: the people on the task by name, the rest as groups. */
  audience(ctx: TenantContext, taskId: string): Promise<EvidenceAudience> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.tasks.requireVisible(tx, ctx, taskId);
      const people = new Map<string, EvidenceAudience['people'][number]>();
      const add = async (id: string | null, role: 'assignee' | 'reporter' | 'collaborator') => {
        if (!id || people.has(id)) return;
        const [m] = await tx
          .select({ displayName: s.members.displayName })
          .from(s.members)
          .where(eq(s.members.id, id));
        if (m) people.set(id, { id, displayName: m.displayName, role });
      };
      await add(task.assigneeId, 'assignee');
      await add(task.reporterId, 'reporter');
      const collaborators = await tx
        .select({ memberId: s.taskCollaborators.memberId })
        .from(s.taskCollaborators)
        .where(eq(s.taskCollaborators.taskId, taskId))
        .orderBy(asc(s.taskCollaborators.memberId));
      for (const c of collaborators) await add(c.memberId, 'collaborator');

      const [department] = await tx
        .select({ name: s.departments.name })
        .from(s.departments)
        .where(eq(s.departments.id, task.departmentId));
      const [project] = task.projectId
        ? await tx
            .select({ name: s.projects.name, visibility: s.projects.visibility })
            .from(s.projects)
            .where(eq(s.projects.id, task.projectId))
        : [];
      // Mirrors `visibleTasks` (ADR 0010): a private project stays inside its members.
      const groups: EvidenceAudience['groups'] = [];
      if (project) groups.push({ kind: 'project_members', name: project.name });
      if (project?.visibility !== 'private') {
        groups.push({ kind: 'department', name: department?.name ?? null });
        groups.push({ kind: 'company_readers', name: null });
      }
      if (project?.visibility === 'tenant') groups.push({ kind: 'everyone', name: null });
      return { people: [...people.values()], groups };
    });
  }

  /** Letters the person may pin here: sent or received, not confidential, not pinned yet. */
  candidates(ctx: TenantContext, taskId: string, q?: string): Promise<LetterSummary[]> {
    return this.db.run(ctx, async (tx) => {
      await this.tasks.requireEditable(tx, ctx, taskId);
      const rows = await tx
        .select({ letter: s.letters, senderName: s.members.displayName })
        .from(s.letters)
        .innerJoin(s.members, eq(s.members.id, s.letters.senderId))
        .where(
          and(
            isNull(s.letters.deletedAt),
            sql`${s.letters.sentAt} is not null`,
            eq(s.letters.confidential, false),
            visibleLetters(ctx.memberId),
            sql`not exists (select 1 from task_evidence e where e.task_id = ${taskId}
              and e.kind = 'letter' and e.subject_id = ${s.letters.id} and e.unpinned_at is null)`,
            q
              ? sql`(${s.letters.subject} ilike ${likePattern(q)} or ${s.letters.number} ilike ${likePattern(q)})`
              : undefined,
          ),
        )
        .orderBy(desc(s.letters.sentAt))
        .limit(30);
      const summaries = await letterSummaries(
        tx,
        rows.map((r) => r.letter.id),
      );
      return rows.map(({ letter, senderName }) => {
        const summary = summaries.get(letter.id);
        return {
          id: letter.id,
          number: letter.number,
          subject: letter.subject,
          preview: liteTextPreview(letter.body.text),
          sender: { id: letter.senderId, displayName: senderName },
          to: summary?.to.slice(0, 3) ?? [],
          urgency: letter.urgency,
          confidential: false,
          sentAt: letter.sentAt?.toISOString() ?? null,
          updatedAt: letter.updatedAt.toISOString(),
          attachmentCount: summary?.attachmentCount ?? 0,
          receivedAs: null,
          read: true,
        };
      });
    });
  }

  pin(ctx: TenantContext, taskId: string, body: PinEvidenceRequest): Promise<Evidence> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.tasks.requireEditable(tx, ctx, taskId);
      const check = await checkLetterPin(tx, ctx.memberId, body.subjectId);
      if (check === 'not_found') throw notFound('Letter');
      if (check === 'not_allowed') throw notAllowed();
      const [row] = await tx
        .insert(s.taskEvidence)
        .values({
          taskId,
          kind: body.kind,
          subjectId: body.subjectId,
          pinnedBy: ctx.memberId,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw alreadyPinned();
      const number = (await letterSummaries(tx, [body.subjectId])).get(body.subjectId)?.number;
      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: taskId,
        actorId: ctx.memberId,
        verb: 'evidence_pinned',
        changes: { evidence: { from: null, to: number ?? '' } },
      });
      await this.db.audit(tx, ctx, {
        action: 'task.evidence_pinned',
        subjectType: 'task',
        subjectId: taskId,
        after: { evidenceId: row.id, kind: row.kind, subjectId: row.subjectId },
      });
      await emitEvent(
        tx,
        'task.evidence_pinned',
        { taskId, evidenceId: row.id, kind: row.kind },
        ctx.memberId,
      );
      const [presented] = await this.present(tx, ctx, task, [row]);
      if (!presented) throw notFound('Evidence');
      return presented;
    });
  }

  /** Soft: the pinner or anyone who may edit the task; the trail stays in the history. */
  unpin(ctx: TenantContext, taskId: string, evidenceId: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.tasks.requireVisible(tx, ctx, taskId);
      const row = await this.requireActive(tx, taskId, evidenceId);
      if (row.pinnedBy !== ctx.memberId && !(await this.edits(tx, ctx, task))) throw forbidden();
      const [done] = await tx
        .update(s.taskEvidence)
        .set({ unpinnedAt: new Date(), unpinnedBy: ctx.memberId })
        .where(and(eq(s.taskEvidence.id, evidenceId), isNull(s.taskEvidence.unpinnedAt)))
        .returning({ id: s.taskEvidence.id });
      if (!done) throw notFound('Evidence');
      const number = (await letterSummaries(tx, [row.subjectId])).get(row.subjectId)?.number;
      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: taskId,
        actorId: ctx.memberId,
        verb: 'evidence_unpinned',
        changes: { evidence: { from: number ?? '', to: null } },
      });
      await this.db.audit(tx, ctx, {
        action: 'task.evidence_unpinned',
        subjectType: 'task',
        subjectId: taskId,
        before: { evidenceId, kind: row.kind, subjectId: row.subjectId },
      });
      await emitEvent(tx, 'task.evidence_unpinned', { taskId, evidenceId }, ctx.memberId);
    });
  }

  /** The pinned item read-only, for anyone who sees the task. */
  detail(ctx: TenantContext, taskId: string, evidenceId: string): Promise<EvidenceDetail> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.tasks.requireVisible(tx, ctx, taskId);
      const row = await this.requireActive(tx, taskId, evidenceId);
      const [presented] = await this.present(tx, ctx, task, [row]);
      const content = await letterBodyOf(tx, row.subjectId);
      if (!presented || !content) throw notFound('Evidence');
      return { ...presented, ...content };
    });
  }

  private async requireActive(tx: Tx, taskId: string, evidenceId: string): Promise<EvidenceRow> {
    const [row] = await tx
      .select()
      .from(s.taskEvidence)
      .where(
        and(
          eq(s.taskEvidence.id, evidenceId),
          eq(s.taskEvidence.taskId, taskId),
          isNull(s.taskEvidence.unpinnedAt),
        ),
      );
    if (!row) throw notFound('Evidence');
    return row;
  }

  private async edits(tx: Tx, ctx: TenantContext, task: typeof s.tasks.$inferSelect) {
    const collaborators = await tx
      .select({ memberId: s.taskCollaborators.memberId })
      .from(s.taskCollaborators)
      .where(
        and(eq(s.taskCollaborators.taskId, task.id), eq(s.taskCollaborators.kind, 'collaborator')),
      );
    return canEditTask(ctx.actor, {
      ...task,
      collaboratorIds: collaborators.map((c) => c.memberId),
    });
  }

  private async present(
    tx: Tx,
    ctx: TenantContext,
    task: typeof s.tasks.$inferSelect,
    rows: EvidenceRow[],
  ): Promise<Evidence[]> {
    if (!rows.length) return [];
    const summaries = await letterSummaries(
      tx,
      rows.map((r) => r.subjectId),
    );
    const editsTask = await this.edits(tx, ctx, task);
    const names = new Map<string, string>();
    for (const r of rows) {
      if (names.has(r.pinnedBy)) continue;
      const [m] = await tx
        .select({ displayName: s.members.displayName })
        .from(s.members)
        .where(eq(s.members.id, r.pinnedBy));
      names.set(r.pinnedBy, m?.displayName ?? '');
    }
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      kind: r.kind,
      subjectId: r.subjectId,
      pinnedBy: { id: r.pinnedBy, displayName: names.get(r.pinnedBy) ?? '' },
      pinnedAt: r.createdAt.toISOString(),
      summary: summaries.get(r.subjectId) ?? null,
      can: { unpin: editsTask || r.pinnedBy === ctx.memberId },
    }));
  }
}
