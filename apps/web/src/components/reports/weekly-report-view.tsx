import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatJalaliDate,
  formatNumber,
  formatPercent,
  type WeeklyReport,
} from '@madar/shared';
import { Badge, Card, CardContent, ProgressBar, StatTile, cn } from '@madar/ui';

import { GoalStatusBadge } from '@/components/goals/goal-card';
import { formatKrValue } from '@/lib/goals';

/** «Lower is better» for overdue; more done is better; new tasks are neutral. */
function Delta({
  now,
  before,
  better,
}: {
  now: number;
  before: number | null;
  better: 'up' | 'down' | 'none';
}) {
  if (before === null)
    return <span className="text-xs text-ink-subtle">{t('reports.delta.unknown')}</span>;
  const diff = now - before;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted [&_svg]:size-3.5">
        <Minus aria-hidden />
        {t('reports.delta.same')}
      </span>
    );
  }
  const good = better === 'none' ? null : diff > 0 === (better === 'up');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold [&_svg]:size-3.5',
        good === null ? 'text-ink-muted' : good ? 'text-success-ink' : 'text-danger-ink',
      )}
    >
      {diff > 0 ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
      {t(diff > 0 ? 'reports.delta.up' : 'reports.delta.down', {
        value: formatNumber(Math.abs(diff)),
      })}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="print-avoid-break print:border-0 print:shadow-none">
      <CardContent className="flex flex-col gap-2 print:p-0 print:py-3">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-ink-muted">{children}</p>
);

/** One weekly report, laid out for the screen and for A4 print (PDF). */
export function WeeklyReportView({
  report,
  companyName,
}: {
  report: WeeklyReport;
  companyName: string;
}) {
  const name = report.department?.name ?? companyName;
  const range = t('reports.weekRange', {
    from: formatCalendarDate(report.weekStart),
    to: formatCalendarDate(report.weekEnd, 'long'),
  });
  return (
    <article className="flex flex-col gap-5" aria-label={t('reports.heading', { name })}>
      <header className="hidden flex-col gap-1 border-b border-line pb-3 print:flex">
        <span className="text-sm text-ink-muted">{companyName}</span>
        <h1 className="text-2xl font-black text-ink">{t('reports.heading', { name })}</h1>
        <span className="text-sm text-ink-muted">
          {range}،{' '}
          {t('reports.generated', { date: formatJalaliDate(new Date(report.generatedAt), 'long') })}
        </span>
      </header>
      {report.partial && (
        <p
          role="status"
          className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink print:hidden"
        >
          {t('reports.partialNote')}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {(
          [
            ['done', 'up'],
            ['created', 'none'],
            ['overdue', 'down'],
          ] as const
        ).map(([key, better]) => (
          <Card key={key} className="print:shadow-none">
            <CardContent className="flex flex-col gap-1 p-3 sm:p-5">
              <StatTile
                label={t(`reports.totals.${key}`)}
                value={formatNumber(report.totals[key])}
                tone={key === 'overdue' && report.totals.overdue > 0 ? 'danger' : 'neutral'}
              />
              <Delta now={report.totals[key]} before={report.previous[key]} better={better} />
            </CardContent>
          </Card>
        ))}
      </div>

      {report.scope === 'company' && (
        <Section title={t('reports.departments')}>
          <ul className="flex flex-col divide-y divide-line">
            {report.departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-ink">{d.name}</span>
                  <span className="text-xs text-ink-muted">
                    {[
                      t('reports.departmentLine', {
                        done: formatNumber(d.done),
                        created: formatNumber(d.created),
                        overdue: formatNumber(d.overdue),
                      }),
                      d.goalProgress === null
                        ? null
                        : t('reports.goalsLine', { value: formatPercent(d.goalProgress) }),
                    ]
                      .filter(Boolean)
                      .join('، ')}
                  </span>
                </div>
                {d.behind && <Badge tone="warning">{t('home.company.behind')}</Badge>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-2 print:grid-cols-1 [&>*]:min-w-0">
        <Section title={t('reports.goals')}>
          {report.goals.length === 0 ? (
            <Empty>{t('reports.goalsEmpty')}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {report.goals.map((g) => (
                <li key={g.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/goals/${g.id}`}
                      className="font-semibold text-ink hover:underline"
                    >
                      {g.title}
                    </Link>
                    <GoalStatusBadge
                      goal={{ status: g.status, progress: g.progress, completedAt: null }}
                    />
                  </div>
                  <ProgressBar value={g.progress} size="sm" showValue />
                  <span className="text-xs text-ink-muted">
                    {[
                      g.change !== null && g.change !== 0
                        ? t('reports.goalChange', {
                            value: `${g.change > 0 ? '+' : '−'}${formatPercent(Math.abs(g.change))}`,
                          })
                        : null,
                      t('reports.goalCheckins', { count: formatNumber(g.checkins) }),
                    ]
                      .filter(Boolean)
                      .join('، ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('reports.keyResults')}>
          {report.keyResults.length === 0 ? (
            <Empty>{t('reports.keyResultsEmpty')}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {report.keyResults.map((kr) => (
                <li key={kr.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold text-ink">{kr.title}</span>
                    <span className="text-xs text-ink-muted">
                      {kr.goalTitle}،{' '}
                      {t('reports.keyResultMove', {
                        from: formatKrValue(kr, kr.from),
                        to: formatKrValue(kr, kr.to),
                        target: formatKrValue(kr, kr.target),
                      })}
                    </span>
                  </div>
                  <Badge
                    tone={
                      kr.status === 'on_track'
                        ? 'success'
                        : kr.status === 'at_risk'
                          ? 'warning'
                          : 'danger'
                    }
                    dot
                  >
                    {t(`goals.statuses.${kr.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('reports.highlights')}>
          {report.highlights.length === 0 ? (
            <Empty>{t('reports.highlightsEmpty')}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {report.highlights.map((h) => (
                <li key={h.id} className="flex flex-col gap-0.5 py-2.5">
                  <Link href={`/tasks/${h.id}`} className="font-semibold text-ink hover:underline">
                    {h.title}
                  </Link>
                  <span className="text-xs text-ink-muted">
                    {h.assignee
                      ? t('reports.highlightBy', {
                          department: h.department.name,
                          name: h.assignee.displayName,
                        })
                      : h.department.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('reports.projects')}>
          {report.atRiskProjects.length === 0 ? (
            <Empty>{t('reports.projectsEmpty')}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {report.atRiskProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-semibold text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="text-xs text-ink-muted">
                      {[
                        p.department?.name,
                        t('home.company.projectProgress', {
                          done: formatNumber(p.done),
                          total: formatNumber(p.total),
                        }),
                        p.dueOn
                          ? t('home.company.projectDue', { date: formatCalendarDate(p.dueOn) })
                          : null,
                      ]
                        .filter(Boolean)
                        .join('، ')}
                    </span>
                  </div>
                  {p.overdue > 0 && (
                    <Badge tone="danger">
                      {t('home.company.projectOverdue', { count: formatNumber(p.overdue) })}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {report.scope === 'department' && (
          <Section title={t('reports.stuck')}>
            {report.stuck.length === 0 ? (
              <Empty>{t('reports.stuckEmpty')}</Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {report.stuck.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="font-semibold text-ink hover:underline"
                      >
                        {task.title}
                      </Link>
                      {task.dueOn && (
                        <span className="text-xs text-ink-muted">
                          {formatCalendarDate(task.dueOn)}
                        </span>
                      )}
                    </div>
                    <Badge tone={task.reason === 'overdue' ? 'danger' : 'warning'}>
                      {task.reason === 'overdue'
                        ? t('home.team.stuckOverdue')
                        : t('home.team.stuckIdle')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </article>
  );
}
