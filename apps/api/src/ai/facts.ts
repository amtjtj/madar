import { formatCalendarDate, type WeeklyReport } from '@madar/shared';

import type { ReportFacts } from './ai-client.js';

const text = (value: string) => value.slice(0, 200);

/**
 * The facts of a weekly report the assistant may see (ADR 0025): counts, goals, projects at risk
 * and the titles of important finished work. Never who did it: highlight assignees are dropped.
 */
export function reportFacts(report: WeeklyReport, companyName: string): ReportFacts {
  return {
    scope: report.scope,
    name: text(report.department?.name ?? companyName),
    // A range of two Jalali dates; the service words it.
    weekLabel: `${formatCalendarDate(report.weekStart, 'medium')} – ${formatCalendarDate(report.weekEnd, 'long')}`,
    partial: report.partial,
    totals: report.totals,
    previous: report.previous,
    departments: report.departments.slice(0, 50).map((d) => ({
      name: text(d.name),
      done: d.done,
      overdue: d.overdue,
      behind: d.behind,
      goalProgress: d.goalProgress,
    })),
    goals: report.goals.slice(0, 30).map((g) => ({
      title: text(g.title),
      progress: Math.min(1, Math.max(0, g.progress)),
      change: g.change,
    })),
    atRiskProjects: report.atRiskProjects.slice(0, 20).map((p) => ({
      name: text(p.name),
      done: p.done,
      total: p.total,
      overdue: p.overdue,
    })),
    highlights: report.highlights.slice(0, 10).map((h) => text(h.title)),
    stuck: report.stuck.length,
  };
}

/** Whether a generated text names a member (a full name of three letters or more). */
export function namesSomeone(generated: string, names: readonly string[]): boolean {
  return names.some((name) => name.trim().length >= 3 && generated.includes(name.trim()));
}
