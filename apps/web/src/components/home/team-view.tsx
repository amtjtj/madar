'use client';

import { HeartHandshake, ListTodo, Target, TimerOff, Unplug } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatNumber,
  formatPercent,
  type DepartmentDashboard,
} from '@madar/shared';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  ColumnChart,
  SelectField,
  StackedBarList,
  StatTile,
} from '@madar/ui';

import { useDepartmentDashboard } from '@/hooks/dashboard';

import { DashboardSkeleton, ReportLink, TileLink } from './company-view';
import { GoalRows } from './goal-rows';

/** «What is my team working on, and who might need a hand?» */
export function TeamView({
  departments,
  departmentId,
  onDepartmentChange,
}: {
  departments: Array<{ id: string; name: string }>;
  departmentId: string | undefined;
  onDepartmentChange: (id: string) => void;
}) {
  const { data, isPending } = useDepartmentDashboard(departmentId);
  return (
    <div className="flex flex-col gap-6">
      {departments.length > 1 && (
        <SelectField
          label={t('home.team.chooseDepartment')}
          className="max-w-xs"
          value={departmentId ?? ''}
          onChange={(e) => onDepartmentChange(e.target.value)}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
        />
      )}
      {isPending || !data ? <DashboardSkeleton /> : <TeamDashboardView data={data} />}
    </div>
  );
}

function TeamDashboardView({ data }: { data: DepartmentDashboard }) {
  const id = data.department.id;
  // Subtasks included: the tiles count them too.
  const tasks = (extra: string) =>
    `/tasks?view=department&departmentId=${id}&subtasks=include${extra}`;
  const { headline } = data;
  return (
    <div className="flex flex-col gap-6">
      <ReportLink href={`/reports?scope=department&departmentId=${id}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TileLink href={tasks('')}>
          <StatTile
            icon={<ListTodo aria-hidden />}
            label={t('home.team.open')}
            value={formatNumber(headline.openTasks)}
          />
        </TileLink>
        <TileLink href={tasks('&due=overdue')}>
          <StatTile
            icon={<TimerOff aria-hidden />}
            label={t('home.team.overdue')}
            value={formatNumber(headline.overdueTasks)}
            tone={headline.overdueTasks > 0 ? 'danger' : 'neutral'}
          />
        </TileLink>
        <TileLink href={tasks('&stuck=true')}>
          <StatTile
            icon={<Unplug aria-hidden />}
            label={t('home.team.stuck')}
            value={formatNumber(headline.stuckTasks)}
            hint={t('home.team.stuckHint')}
            tone={headline.stuckTasks > 0 ? 'warning' : 'neutral'}
          />
        </TileLink>
        <TileLink href={`/goals?view=department&departmentId=${id}`}>
          <StatTile
            icon={<Target aria-hidden />}
            label={t('home.team.goalProgress')}
            value={
              headline.goalProgress === null
                ? t('home.noValue')
                : formatPercent(headline.goalProgress)
            }
          />
        </TileLink>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {data.needsHelp && (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="flex items-center gap-2 text-lg font-bold text-ink [&_svg]:size-5">
                  <HeartHandshake aria-hidden className="text-primary-ink" />
                  {t('home.team.helpTitle')}
                </h2>
                <p className="text-xs text-ink-subtle">{t('home.team.helpHint')}</p>
              </div>
              {data.needsHelp.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('home.team.helpEmpty')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {data.needsHelp.map(({ member, reasons }) => (
                    <li key={member.id}>
                      <Link
                        href={tasks(`&assigneeId=${member.id}`)}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-sunken"
                      >
                        <Avatar name={member.displayName} size="sm" />
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="font-semibold text-ink">{member.displayName}</span>
                          <span className="flex flex-wrap gap-1">
                            {reasons.map((r) => (
                              <Badge key={r.kind} tone="neutral">
                                {t(`home.team.reasons.${r.kind}`, { count: formatNumber(r.count) })}
                              </Badge>
                            ))}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-bold text-ink">{t('home.team.workloadTitle')}</h2>
              <p className="text-xs text-ink-subtle">{t('home.team.workloadHint')}</p>
            </div>
            <StackedBarList
              title={t('home.team.workloadTitle')}
              series={[
                { key: 'todo', label: t('home.team.todo'), fill: 'bg-chart-2' },
                { key: 'doing', label: t('home.team.inProgress'), fill: 'bg-chart-1' },
              ]}
              rows={data.workload.map((w) => ({
                key: w.member.id,
                label: w.member.displayName,
                values: [w.todo, w.inProgress],
                note: w.overdue ? (
                  <span className="shrink-0 text-xs font-semibold text-danger-ink">
                    {t('home.team.overdueNote', { count: formatNumber(w.overdue) })}
                  </span>
                ) : undefined,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-ink">{t('home.team.stuckTitle')}</h2>
            {data.stuck.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('home.team.stuckEmpty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {data.stuck.map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-sunken"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-semibold text-ink">{task.title}</span>
                        <span className="text-xs text-ink-muted">
                          {[
                            task.assignee?.displayName ?? t('home.team.unassigned'),
                            task.dueOn ? formatCalendarDate(task.dueOn) : null,
                          ]
                            .filter(Boolean)
                            .join('، ')}
                        </span>
                      </div>
                      <Badge tone={task.reason === 'overdue' ? 'danger' : 'warning'}>
                        {task.reason === 'overdue'
                          ? t('home.team.stuckOverdue')
                          : t('home.team.stuckIdle')}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-ink">{t('home.team.goalsTitle')}</h2>
            {data.goals.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('home.team.goalsEmpty')}</p>
            ) : (
              <GoalRows goals={data.goals} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">{t('home.team.weeklyTitle')}</h2>
            <ColumnChart
              title={t('home.team.weeklyTitle')}
              points={data.weeklyDone.map((w) => ({
                key: w.weekStart,
                label: formatCalendarDate(w.weekStart, 'medium'),
                value: w.count,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
