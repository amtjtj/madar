import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle } from '@madar/db';
import { weeklyReport } from '@madar/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { AiClient } from './ai-client.js';
import { namesSomeone, reportFacts } from './facts.js';
import { loadAiSettings } from './settings.js';

/** Reports this recent get a summary when they lack one (also after the assistant is turned on). */
const RECENT_DAYS = 21;
/** Per company and run: a model on CPU takes a while for each. */
const PER_RUN = 5;

/**
 * Summaries of stored weekly reports (plan phase-3-step-16a, ADR 0025), on the worker's own queue
 * every ten minutes. The model is called outside any transaction; a summary is written once, and a
 * failed or discarded one is simply tried again on a later run.
 */
@Injectable()
export class ReportSummaryJob {
  private readonly logger = new Logger('ReportSummaries');

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly client: AiClient,
  ) {}

  async runAll(now = new Date()): Promise<void> {
    if (!this.client.available) return;
    for (const tenant of await listActiveTenants(this.handle.db)) {
      try {
        await this.runForTenant(tenant.id, now);
      } catch (error) {
        this.logger.error(`tenant ${tenant.id}: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
  }

  /** Returns how many summaries were written. */
  async runForTenant(tenantId: string, now = new Date()): Promise<number> {
    if (!this.client.available) return 0;
    const pending = await withTenant(this.handle.db, { tenantId }, async (tx) => {
      if (!(await loadAiSettings(tx, tenantId)).enabled) return null;
      const [tenant] = await tx
        .select({ name: s.tenants.name })
        .from(s.tenants)
        .where(eq(s.tenants.id, tenantId));
      const reports = await tx
        .select({ id: s.weeklyReports.id, data: s.weeklyReports.data })
        .from(s.weeklyReports)
        .leftJoin(
          s.reportSummaries,
          and(
            eq(s.reportSummaries.tenantId, s.weeklyReports.tenantId),
            eq(s.reportSummaries.reportId, s.weeklyReports.id),
          ),
        )
        .where(
          and(
            isNull(s.reportSummaries.id),
            gt(s.weeklyReports.createdAt, new Date(now.getTime() - RECENT_DAYS * 86_400_000)),
          ),
        )
        .orderBy(desc(s.weeklyReports.createdAt))
        .limit(PER_RUN);
      const names = await tx.select({ name: s.members.displayName }).from(s.members);
      return { company: tenant?.name ?? '', reports, names: names.map((n) => n.name) };
    });
    if (!pending) return 0;
    let written = 0;
    for (const report of pending.reports) {
      const parsed = weeklyReport.safeParse(report.data);
      if (!parsed.success) continue;
      let result: { text: string; model: string };
      try {
        result = await this.client.reportSummary(reportFacts(parsed.data, pending.company));
      } catch {
        continue; // AiClient logged what failed (never the content).
      }
      // The model was never told anyone's name; if one shows up anyway, the draft is dropped.
      if (namesSomeone(result.text, pending.names)) {
        this.logger.warn(`report ${report.id}: summary discarded (names a person)`);
        continue;
      }
      const inserted = await withTenant(this.handle.db, { tenantId }, (tx) =>
        tx
          .insert(s.reportSummaries)
          .values({ reportId: report.id, text: result.text, model: result.model.slice(0, 100) })
          .onConflictDoNothing()
          .returning({ id: s.reportSummaries.id }),
      );
      written += inserted.length;
    }
    return written;
  }
}
