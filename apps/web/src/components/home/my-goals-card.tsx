'use client';

import Link from 'next/link';

import { t } from '@madar/i18n';
import { Card, CardContent, ProgressBar } from '@madar/ui';

import { useGoalPeriods, useGoals } from '@/hooks/goals';

/** «My goals this season» under Today: one line per goal, only when there are any. */
export function MyGoalsCard() {
  const { data: periods } = useGoalPeriods();
  const periodId = periods?.find((p) => p.current)?.id;
  const { data: goals } = useGoals('mine', periodId);
  if (!goals?.length) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">{t('home.myGoals.title')}</h2>
          <Link href="/goals" className="text-sm font-semibold text-primary-ink hover:underline">
            {t('home.myGoals.all')}
          </Link>
        </div>
        <ul className="flex flex-col gap-3">
          {goals.slice(0, 4).map((goal) => (
            <li key={goal.id}>
              <Link href={`/goals/${goal.id}`} className="block rounded-lg hover:bg-sunken">
                <ProgressBar value={goal.progress} size="sm" showValue label={goal.title} />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
