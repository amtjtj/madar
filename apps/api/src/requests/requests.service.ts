import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  approvalChain,
  approvalSettings,
  leaveWorkingDays,
  REQUESTS_PAGE,
  zonedInstant,
  type ApprovalSettings,
  type CreateRequestRequest,
  type DecideRequestRequest,
  type LeaveData,
  type ListRequestsQuery,
  type RequestCounts,
  type RequestDetail,
  type RequestKind,
  type RequestRoute,
  type RequestSummary,
} from '@madar/shared';
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { attachmentRows, bindUploads, toAttachment } from '../files/attachments-db.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { leadsCompany } from '../work/access.js';
import { managementChain } from '../work/ranking.js';
import { currentApprover, visibleRequests, waitingOn } from './access.js';

type RequestRow = typeof s.approvalRequests.$inferSelect;

const requester = alias(s.members, 'requester');
const waiting = alias(s.members, 'waiting');

const closed = () => new ApiError(HttpStatus.CONFLICT, 'request_closed', 'Request is decided');
const leaveInvalid = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'leave_invalid', 'No working time in this leave');

/**
 * Requests and approvals (plan phase-3-step-17b, ADR 0028): made by anyone for themselves, decided
 * step by step by the approvers worked out when it was made (the snapshot), never by the requester.
 * The final approval of a leave writes its `leaves` row in the same transaction.
 */
@Injectable()
export class RequestsService {
  constructor(private readonly db: TenantDb) {}

  settings(ctx: TenantContext): Promise<ApprovalSettings> {
    return this.db.run(ctx, (tx) => loadApprovalSettings(tx, ctx.tenantId));
  }

  setSettings(ctx: TenantContext, body: ApprovalSettings): Promise<ApprovalSettings> {
    return this.db.run(ctx, async (tx) => {
      const before = await loadApprovalSettings(tx, ctx.tenantId);
      await tx
        .update(s.tenants)
        .set({
          settings: sql`${s.tenants.settings} || ${JSON.stringify({ approvals: body })}::jsonb`,
        })
        // `tenants` is control-plane (no RLS): the session's tenant guards the row as well.
        .where(and(eq(s.tenants.id, ctx.tenantId), sql`${s.tenants.id} = app.current_tenant_id()`));
      await this.db.audit(tx, ctx, {
        action: 'approval_settings.updated',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        before: { ...before },
        after: { ...body },
      });
      return body;
    });
  }

  /** Who a request of this kind (and amount) would go to, before it is made. */
  route(ctx: TenantContext, kind: RequestKind, amountToman?: number): Promise<RequestRoute> {
    return this.db.run(ctx, async (tx) => {
      const { approvers } = await this.chainFor(tx, ctx, kind, amountToman ?? null);
      return { approvers: await this.people(tx, approvers) };
    });
  }

  create(ctx: TenantContext, body: CreateRequestRequest): Promise<RequestDetail> {
    return this.db.run(ctx, async (tx) => {
      const amountToman = body.kind === 'expense' ? body.data.amountToman : null;
      const { approvers, thresholdToman, departmentId } = await this.chainFor(
        tx,
        ctx,
        body.kind,
        amountToman,
      );
      if (!departmentId) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'no_department', 'Join a department first');
      }
      if (approvers.length === 0) {
        throw new ApiError(HttpStatus.CONFLICT, 'no_approver', 'Nobody can approve this');
      }
      if (body.kind === 'leave') await this.checkLeave(tx, ctx, ctx.memberId, body.data);
      const [row] = await tx
        .insert(s.approvalRequests)
        .values({
          kind: body.kind,
          requesterId: ctx.memberId,
          departmentId,
          // Leave and expense are named by their kind in the UI (no text of ours in the database).
          title: body.kind === 'general' ? body.title : '',
          data: body.data,
          amountRial: amountToman === null ? null : amountToman * 10,
          snapshot: { approvers, ...(body.kind === 'expense' ? { thresholdToman } : {}) },
        })
        .returning();
      if (!row) throw new Error('request insert failed');
      if (body.kind !== 'leave') {
        await bindUploads(tx, ctx, body.uploadIds, { type: 'approval_request', id: row.id });
      }
      await emitEvent(
        tx,
        'request.submitted',
        { requestId: row.id, approverId: approvers[0], requesterId: ctx.memberId },
        ctx.memberId,
      );
      await this.db.audit(tx, ctx, {
        action: 'request.submitted',
        subjectType: 'approval_request',
        subjectId: row.id,
        after: { kind: row.kind, amountToman, approvers },
      });
      return this.detail(tx, ctx, row);
    });
  }

  list(ctx: TenantContext, query: ListRequestsQuery): Promise<RequestSummary[]> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const box: SQL =
        query.box === 'pending'
          ? waitingOn(ctx.actor)
          : query.box === 'mine'
            ? eq(s.approvalRequests.requesterId, me)
            : sql`exists (select 1 from approval_steps st where st.request_id = ${s.approvalRequests.id} and st.decided_by = ${me})`;
      const rows = await tx
        .select()
        .from(s.approvalRequests)
        .where(
          and(
            box,
            visibleRequests(ctx.actor),
            query.before ? lt(s.approvalRequests.id, query.before) : undefined,
          ),
        )
        .orderBy(desc(s.approvalRequests.id))
        .limit(REQUESTS_PAGE);
      return this.summaries(tx, rows);
    });
  }

  counts(ctx: TenantContext): Promise<RequestCounts> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.approvalRequests)
        .where(and(waitingOn(ctx.actor), visibleRequests(ctx.actor)));
      return { pending: row?.n ?? 0 };
    });
  }

  get(ctx: TenantContext, id: string): Promise<RequestDetail> {
    return this.db.run(ctx, async (tx) =>
      this.detail(tx, ctx, await this.requireVisible(tx, ctx, id)),
    );
  }

  decide(ctx: TenantContext, id: string, body: DecideRequestRequest): Promise<RequestDetail> {
    return this.db.run(ctx, async (tx) => {
      // Locked: two approvers (or a double tap) decide one after the other.
      await tx
        .select({ id: s.approvalRequests.id })
        .from(s.approvalRequests)
        .where(eq(s.approvalRequests.id, id))
        .for('update');
      const row = await this.requireVisible(tx, ctx, id);
      if (row.status !== 'pending') throw closed();
      const approverId = row.snapshot.approvers[row.currentStep];
      if (!approverId || !(await this.mayDecide(tx, ctx, row, approverId))) throw forbidden();
      if (body.decision === 'rejected' && !body.comment) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'comment_required', 'Say why it is rejected');
      }
      await tx.insert(s.approvalSteps).values({
        requestId: row.id,
        stepIndex: row.currentStep,
        approverId,
        decidedBy: ctx.memberId,
        decision: body.decision,
        comment: body.comment,
      });
      const last = row.currentStep + 1 >= row.snapshot.approvers.length;
      const now = new Date();
      if (body.decision === 'approved' && !last) {
        const [next] = await tx
          .update(s.approvalRequests)
          .set({ currentStep: row.currentStep + 1 })
          .where(eq(s.approvalRequests.id, row.id))
          .returning();
        await emitEvent(
          tx,
          'request.advanced',
          {
            requestId: row.id,
            approverId: row.snapshot.approvers[row.currentStep + 1],
            requesterId: row.requesterId,
          },
          ctx.memberId,
        );
        await this.auditDecision(tx, ctx, row, 'approved');
        return this.detail(tx, ctx, next ?? row);
      }
      const status = body.decision;
      if (status === 'approved' && row.kind === 'leave') {
        // Checked again: another leave may have been approved since this one was made.
        const data = row.data as LeaveData;
        await this.checkLeave(tx, ctx, row.requesterId, data);
        await this.writeLeave(tx, ctx, row, data);
      }
      const [done] = await tx
        .update(s.approvalRequests)
        .set({ status, decidedAt: now })
        .where(eq(s.approvalRequests.id, row.id))
        .returning();
      await emitEvent(
        tx,
        'request.decided',
        { requestId: row.id, status, requesterId: row.requesterId },
        ctx.memberId,
      );
      await this.auditDecision(tx, ctx, row, status);
      return this.detail(tx, ctx, done ?? row);
    });
  }

  cancel(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await tx
        .select({ id: s.approvalRequests.id })
        .from(s.approvalRequests)
        .where(eq(s.approvalRequests.id, id))
        .for('update');
      const row = await this.requireVisible(tx, ctx, id);
      if (row.requesterId !== ctx.memberId) throw forbidden();
      if (row.status !== 'pending') throw closed();
      await tx
        .update(s.approvalRequests)
        .set({ status: 'canceled', decidedAt: new Date() })
        .where(eq(s.approvalRequests.id, row.id));
      await emitEvent(
        tx,
        'request.canceled',
        { requestId: row.id, approverId: row.snapshot.approvers[row.currentStep] },
        ctx.memberId,
      );
      await this.db.audit(tx, ctx, {
        action: 'request.canceled',
        subjectType: 'approval_request',
        subjectId: row.id,
        after: { kind: row.kind },
      });
    });
  }

  async requireVisible(tx: Tx, ctx: TenantContext, id: string): Promise<RequestRow> {
    const [row] = await tx
      .select()
      .from(s.approvalRequests)
      .where(and(eq(s.approvalRequests.id, id), visibleRequests(ctx.actor)));
    if (!row) throw notFound('Request');
    return row;
  }

  /**
   * The step's approver decides; the leadership stands in only when that approver is no longer
   * active (left or suspended). Never the requester.
   */
  private async mayDecide(
    tx: Tx,
    ctx: TenantContext,
    row: RequestRow,
    approverId: string,
  ): Promise<boolean> {
    if (row.requesterId === ctx.memberId) return false;
    if (approverId === ctx.memberId) return true;
    if (!leadsCompany(ctx.actor)) return false;
    const [approver] = await tx
      .select({ status: s.members.status })
      .from(s.members)
      .where(eq(s.members.id, approverId));
    return approver?.status !== 'active';
  }

  /** The approvers of a request I would make now, with the threshold and my department. */
  private async chainFor(
    tx: Tx,
    ctx: TenantContext,
    kind: RequestKind,
    amountToman: number | null,
  ): Promise<{ approvers: string[]; thresholdToman: number; departmentId: string | null }> {
    const [primary] = await tx
      .select({ id: s.departmentMemberships.departmentId })
      .from(s.departmentMemberships)
      .innerJoin(s.departments, eq(s.departments.id, s.departmentMemberships.departmentId))
      .where(
        and(eq(s.departmentMemberships.memberId, ctx.memberId), isNull(s.departments.archivedAt)),
      )
      .orderBy(desc(s.departmentMemberships.isPrimary))
      .limit(1);
    const active = async (ids: string[]) => {
      if (ids.length === 0) return [];
      const rows = await tx
        .select({ id: s.members.id })
        .from(s.members)
        .where(and(inArray(s.members.id, ids), eq(s.members.status, 'active')));
      const ok = new Set(rows.map((r) => r.id));
      return ids.filter((id) => ok.has(id));
    };
    const managerChain = await active(await managementChain(tx, ctx.memberId));
    const departmentManagers = primary
      ? await active(
          (
            await tx
              .select({
                id: s.departmentMemberships.memberId,
                role: s.departmentMemberships.deptRole,
              })
              .from(s.departmentMemberships)
              .where(
                and(
                  eq(s.departmentMemberships.departmentId, primary.id),
                  inArray(s.departmentMemberships.deptRole, ['head', 'manager']),
                ),
              )
          )
            .sort((a, b) => (a.role === b.role ? 0 : a.role === 'head' ? -1 : 1))
            // Only someone above me: a head goes to the leadership, a manager to a head.
            .filter((r, _i, all) => {
              const mine = all.find((x) => x.id === ctx.memberId)?.role;
              return mine === 'head' ? false : mine === 'manager' ? r.role === 'head' : true;
            })
            .map((r) => r.id),
        )
      : [];
    // The leadership: tenant-wide task or goal management (`leadsCompany`), oldest first.
    const leaders = (
      await tx
        .selectDistinct({ id: s.members.id, createdAt: s.members.createdAt })
        .from(s.members)
        .innerJoin(s.memberRoles, eq(s.memberRoles.memberId, s.members.id))
        .innerJoin(s.roleGrants, eq(s.roleGrants.roleId, s.memberRoles.roleId))
        .where(
          and(
            eq(s.members.status, 'active'),
            inArray(s.roleGrants.permission, ['task.manage', 'goal.manage']),
            eq(s.roleGrants.scope, 'tenant'),
          ),
        )
        .orderBy(asc(s.members.createdAt))
    ).map((r) => r.id);
    const { expenseThresholdToman } = await loadApprovalSettings(tx, ctx.tenantId);
    const approvers = approvalChain(
      { requesterId: ctx.memberId, managerChain, departmentManagers, leaders },
      { kind, amountToman, thresholdToman: expenseThresholdToman },
    );
    return { approvers, thresholdToman: expenseThresholdToman, departmentId: primary?.id ?? null };
  }

  /** A leave takes working time and does not overlap an approved leave of the same person. */
  private async checkLeave(tx: Tx, ctx: TenantContext, memberId: string, data: LeaveData) {
    // One leave check per person at a time, so two overlapping approvals cannot both pass.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`leave:${memberId}`}, 0))`,
    );
    const { calendar, timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
    const from = data.kind === 'daily' ? data.startsOn : data.on;
    const to = data.kind === 'daily' ? data.endsOn : data.on;
    if (data.kind === 'daily' && leaveWorkingDays(calendar, from, to) === 0) throw leaveInvalid();
    if (data.kind === 'hourly' && leaveWorkingDays(calendar, from, to) === 0) throw leaveInvalid();
    const overlapping = await tx
      .select({ kind: s.leaves.kind, startsAt: s.leaves.startsAt, endsAt: s.leaves.endsAt })
      .from(s.leaves)
      .where(
        and(
          eq(s.leaves.memberId, memberId),
          sql`${s.leaves.startsOn} <= ${to} and ${s.leaves.endsOn} >= ${from}`,
        ),
      );
    const clash = overlapping.some((leave) => {
      if (data.kind === 'daily' || leave.kind === 'daily') return true;
      const start = zonedInstant(data.on, data.from, timeZone);
      const end = zonedInstant(data.on, data.to, timeZone);
      return !!leave.startsAt && !!leave.endsAt && leave.startsAt < end && leave.endsAt > start;
    });
    if (clash) {
      throw new ApiError(HttpStatus.CONFLICT, 'leave_overlap', 'Overlaps an approved leave');
    }
  }

  private async writeLeave(tx: Tx, ctx: TenantContext, row: RequestRow, data: LeaveData) {
    const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
    await tx.insert(s.leaves).values(
      data.kind === 'daily'
        ? {
            memberId: row.requesterId,
            requestId: row.id,
            kind: 'daily',
            startsOn: data.startsOn,
            endsOn: data.endsOn,
          }
        : {
            memberId: row.requesterId,
            requestId: row.id,
            kind: 'hourly',
            startsOn: data.on,
            endsOn: data.on,
            startsAt: zonedInstant(data.on, data.from, timeZone),
            endsAt: zonedInstant(data.on, data.to, timeZone),
          },
    );
  }

  private async auditDecision(
    tx: Tx,
    ctx: TenantContext,
    row: RequestRow,
    decision: 'approved' | 'rejected',
  ) {
    // No comment text in the log: the reason stays with the request.
    await this.db.audit(tx, ctx, {
      action: decision === 'approved' ? 'request.approved' : 'request.rejected',
      subjectType: 'approval_request',
      subjectId: row.id,
      after: {
        kind: row.kind,
        step: row.currentStep,
        amountToman: row.amountRial === null ? null : row.amountRial / 10,
      },
    });
  }

  private async people(tx: Tx, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({ id: s.members.id, displayName: s.members.displayName })
      .from(s.members)
      .where(inArray(s.members.id, ids));
    return ids.flatMap((id) => rows.filter((r) => r.id === id));
  }

  private async summaries(tx: Tx, rows: RequestRow[]): Promise<RequestSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const extra = await tx
      .select({
        id: s.approvalRequests.id,
        requesterName: requester.displayName,
        departmentName: s.departments.name,
        waitingId: waiting.id,
        waitingName: waiting.displayName,
      })
      .from(s.approvalRequests)
      .innerJoin(requester, eq(requester.id, s.approvalRequests.requesterId))
      .innerJoin(s.departments, eq(s.departments.id, s.approvalRequests.departmentId))
      .leftJoin(
        waiting,
        and(
          eq(s.approvalRequests.status, 'pending'),
          sql`${waiting.id}::text = ${currentApprover}`,
        ),
      )
      .where(inArray(s.approvalRequests.id, ids));
    return rows.map((row) => {
      const e = extra.find((x) => x.id === row.id);
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        status: row.status,
        requester: { id: row.requesterId, displayName: e?.requesterName ?? '' },
        department: { id: row.departmentId, name: e?.departmentName ?? '' },
        data: row.data as RequestSummary['data'],
        amountToman: row.amountRial === null ? null : row.amountRial / 10,
        waitingOn:
          row.status === 'pending' && e?.waitingId
            ? { id: e.waitingId, displayName: e.waitingName ?? '' }
            : null,
        stepCount: row.snapshot.approvers.length,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      };
    });
  }

  private async detail(tx: Tx, ctx: TenantContext, row: RequestRow): Promise<RequestDetail> {
    const [summary] = await this.summaries(tx, [row]);
    if (!summary) throw notFound('Request');
    const decisions = await tx
      .select()
      .from(s.approvalSteps)
      .where(eq(s.approvalSteps.requestId, row.id))
      .orderBy(asc(s.approvalSteps.stepIndex));
    const names = new Map(
      (
        await this.people(tx, [...row.snapshot.approvers, ...decisions.map((d) => d.decidedBy)])
      ).map((p) => [p.id, p.displayName] as const),
    );
    const steps = row.snapshot.approvers.map((approverId, index) => {
      const d = decisions.find((x) => x.stepIndex === index);
      return {
        index,
        approver: { id: approverId, displayName: names.get(approverId) ?? '' },
        decision: d?.decision ?? null,
        comment: d ? d.comment || null : null,
        decidedAt: d?.decidedAt.toISOString() ?? null,
        decidedBy:
          d && d.decidedBy !== approverId
            ? { id: d.decidedBy, displayName: names.get(d.decidedBy) ?? '' }
            : null,
      };
    });
    const files = await attachmentRows(
      tx,
      and(eq(s.attachments.subjectType, 'approval_request'), eq(s.attachments.subjectId, row.id)),
    );
    let leaveDays: number | null = null;
    if (row.kind === 'leave' && (row.data as LeaveData).kind === 'daily') {
      const data = row.data as Extract<LeaveData, { kind: 'daily' }>;
      const { calendar } = await loadWorkCalendar(tx, ctx.tenantId);
      leaveDays = leaveWorkingDays(calendar, data.startsOn, data.endsOn);
    }
    const approverId = row.snapshot.approvers[row.currentStep];
    return {
      ...summary,
      steps,
      leaveDays,
      // A request's files are part of the record: nobody deletes them.
      attachments: files.map((f) => toAttachment(f.row, f.uploaderName, false)),
      can: {
        decide:
          row.status === 'pending' &&
          !!approverId &&
          (await this.mayDecide(tx, ctx, row, approverId)),
        cancel: row.status === 'pending' && row.requesterId === ctx.memberId,
      },
    };
  }
}

export async function loadApprovalSettings(tx: Tx, tenantId: string): Promise<ApprovalSettings> {
  const [tenant] = await tx
    .select({ settings: s.tenants.settings })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  const parsed = approvalSettings.safeParse(
    (tenant?.settings as { approvals?: unknown } | null)?.approvals ?? {},
  );
  return parsed.success ? parsed.data : approvalSettings.parse({});
}
