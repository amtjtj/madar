'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { t } from '@madar/i18n';
import { Card, EmptyState, SelectField, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { GoalCard } from '@/components/goals/goal-card';
import { GoalTree } from '@/components/goals/goal-tree';
import { NewGoalButton } from '@/components/goals/new-goal-button';
import { Segmented } from '@/components/work/task-views';
import { useGoalPeriods, useGoals, type GoalView } from '@/hooks/goals';
import { periodName } from '@/lib/goals';

const VIEWS: GoalView[] = ['mine', 'department', 'company'];
const DEFAULT_LEVEL = { mine: 'individual', department: 'department', company: 'company' } as const;

export default function GoalsPage() {
  return (
    <Suspense>
      <GoalsScreen />
    </Suspense>
  );
}

function GoalsScreen() {
  const search = useSearchParams();
  const requested = search.get('view') as GoalView | null;
  const departmentId = search.get('departmentId') ?? undefined;
  const { data: periods } = useGoalPeriods();
  const [view, setView] = useState<GoalView>(
    requested && VIEWS.includes(requested) ? requested : 'mine',
  );
  const [chosenPeriod, setChosenPeriod] = useState<string>();
  const periodId = chosenPeriod ?? periods?.find((p) => p.current)?.id;
  const { data: goals, isPending } = useGoals(
    view,
    periodId,
    view === 'department' ? departmentId : undefined,
  );

  return (
    <>
      <PageHeader
        title={t('goals.title')}
        subtitle={t('goals.subtitle')}
        action={
          periodId ? (
            <NewGoalButton periodId={periodId} defaultLevel={DEFAULT_LEVEL[view]} />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5 pb-20 md:pb-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="overflow-x-auto">
            <Segmented
              label={t('goals.viewLabel')}
              value={view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: t(`goals.views.${v}`) }))}
            />
          </div>
          {periods && (
            <SelectField
              label={t('goals.period')}
              className="w-44"
              value={periodId ?? ''}
              onChange={(e) => setChosenPeriod(e.target.value)}
              options={periods.map((p) => ({
                value: p.id,
                label: p.current ? `${periodName(p)} ${t('goals.current')}` : periodName(p),
              }))}
            />
          )}
        </div>
        {isPending || !goals ? (
          <div className="flex flex-col gap-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : goals.length === 0 ? (
          <Card>
            <EmptyState
              title={t(`goals.empty.${view}`)}
              description={t(`goals.empty.${view}Hint`)}
            />
          </Card>
        ) : view === 'company' ? (
          <GoalTree goals={goals} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {goals.map((goal) => (
              <li key={goal.id}>
                <GoalCard goal={goal} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
