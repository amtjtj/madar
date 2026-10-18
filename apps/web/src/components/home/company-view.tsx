'use client';

import { AlertTriangle, FileText, FolderKanban, Target, TimerOff } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatNumber,
  formatPercent,
  type CompanyDashboard,
} from '@madar/shared';
import {
  Badge,
  BarList,
  Card,
  CardContent,
  ColumnChart,
  EmptyState,
  Skeleton,
  StatTile,
} from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useCompanyDashboard } from '@/hooks/dashboard';
import { periodName } from '@/lib/goals';

import { GoalRows } from './goal-rows';

/** «Where is the company and where is it stuck?» — in under 30 seconds. */
export function CompanyView() {
  const { data, isPending } = useCompanyDashboard(true);
  if (isPending || !data) return <DashboardSkeleton />;
  return <CompanyDashboardView data={data} />;
}

function CompanyDashboardView({ data }: { data: CompanyDashboard }) {
  const { headline } = data;
  const season = data.season ? periodName(data.season) : '';
  const overdueByDepartment = data.departments
    .filter((d) => d.overdueTasks > 0)
    .map((d) => ({
      key: d.id,
      label: d.name,
      value: d.overdueTasks,
      href: `/tasks?view=visible&departmentId=${d.id}&due=overdue`,
    }));

  return (
    <div className="flex flex-col gap-6">
      <ReportLink href="/reports?scope=company" />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <TileLink href="/goals?view=company">
          <StatTile
            icon={<Target aria-hidden />}
            label={t('home.company.goalProgress')}
            value={
              headline.goalProgress === null
                ? t('home.noValue')
                : formatPercent(headline.goalProgress)
            }
            hint={
              headline.goalProgress === null
                ? t('home.company.noGoals')
                : t('home.company.goalProgressHint', {
                    count: formatNumber(data.goals.length),
                    season,
                  })
            }
          />
        </TileLink>
        <TileLink href="/tasks?view=visible&due=overdue">
          <StatTile
            icon={<TimerOff aria-hidden />}
            label={t('home.company.overdue')}
            value={formatNumber(headline.overdueTasks)}
            hint={t('home.company.overdueHint')}
            tone={headline.overdueTasks > 0 ? 'danger' : 'neutral'}
          />
        </TileLink>
        <TileLink href="/projects?risk=true">
          <StatTile
            icon={<FolderKanban aria-hidden />}
            label={t('home.company.atRisk')}
            value={formatNumber(headline.atRiskProjects)}
            hint={t('home.company.atRiskHint')}
            tone={headline.atRiskProjects > 0 ? 'warning' : 'neutral'}
          />
        </TileLink>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-ink">{t('home.company.goalsTitle')}</h2>
            {data.goals.length === 0 ? (
              <EmptyState
                title={t('home.company.goalsEmpty')}
                action={
                  <Link
                    href="/goals?view=company"
                    className="font-semibold text-primary-ink hover:underline"
                  >
                    {t('home.company.goalsAdd')}
                  </Link>
                }
              />
            ) : (
              <GoalRows goals={data.goals} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-ink">{t('home.company.departmentsTitle')}</h2>
            <ul className="flex flex-col divide-y divide-line">
              {data.departments.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/?tab=team&department=${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-sunken"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold text-ink">{d.name}</span>
                      <span className="text-xs text-ink-muted">
                        {[
                          d.goalProgress === null
                            ? t('home.company.noDepartmentGoals')
                            : t('home.company.departmentGoals', {
                                value: formatPercent(d.goalProgress),
                              }),
                          t('home.company.openOverdue', {
                            open: formatNumber(d.openTasks),
                            overdue: formatNumber(d.overdueTasks),
                          }),
                        ].join('، ')}
                      </span>
                    </div>
                    {d.behind ? (
                      <Badge tone="warning">
                        <AlertTriangle aria-hidden />
                        {t('home.company.behind')}
                      </Badge>
                    ) : (
                      <Badge tone="success" dot>
                        {t('home.company.onTrack')}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">{t('home.company.overdueByDepartment')}</h2>
            {overdueByDepartment.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('home.company.noOverdue')}</p>
            ) : (
              <BarList
                title={t('home.company.overdueByDepartment')}
                tone="danger"
                items={overdueByDepartment}
                link={NextLink}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">{t('home.company.weeklyTitle')}</h2>
            <ColumnChart
              title={t('home.company.weeklyTitle')}
              points={data.weeklyDone.map((w) => ({
                key: w.weekStart,
                label: formatCalendarDate(w.weekStart, 'medium'),
                value: w.count,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-lg font-bold text-ink">{t('home.company.projectsTitle')}</h2>
          {data.atRiskProjects.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('home.company.projectsEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.atRiskProjects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-3 hover:bg-sunken"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold text-ink">{p.name}</span>
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
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** «Weekly report» shortcut above a dashboard. */
export function ReportLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="-mb-3 inline-flex items-center gap-1.5 self-end text-sm font-semibold text-primary-ink hover:underline [&_svg]:size-4"
    >
      <FileText aria-hidden />
      {t('reports.open')}
    </Link>
  );
}

export function TileLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Card interactive className="p-0">
      <Link href={href} className="block h-full p-3 sm:p-5">
        {children}
      </Link>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
