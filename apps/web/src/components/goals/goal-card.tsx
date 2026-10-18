import { Building2, CircleCheck, Target, User } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { formatNumber, type GoalSummary } from '@madar/shared';
import { Badge, Card, ProgressBar, cn } from '@madar/ui';

import { statusTone } from '@/lib/goals';

const LEVEL_ICON = {
  company: <Target aria-hidden />,
  department: <Building2 aria-hidden />,
  individual: <User aria-hidden />,
} as const;

export function GoalStatusBadge({
  goal,
}: {
  goal: Pick<GoalSummary, 'status' | 'completedAt' | 'progress'>;
}) {
  if (goal.completedAt && goal.progress >= 1) {
    return (
      <Badge tone="success">
        <CircleCheck aria-hidden />
        {t('goals.completed')}
      </Badge>
    );
  }
  return (
    <Badge tone={statusTone(goal.status)} dot={goal.status !== null}>
      {goal.status ? t(`goals.statuses.${goal.status}`) : t('goals.noStatus')}
    </Badge>
  );
}

/** One goal: level, owner, alignment, progress and status. */
export function GoalCard({
  goal,
  showParent = true,
  className,
}: {
  goal: GoalSummary;
  showParent?: boolean;
  className?: string;
}) {
  return (
    <Card interactive className={cn('p-0', className)}>
      <Link href={`/goals/${goal.id}`} className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">
            {LEVEL_ICON[goal.level]}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="font-bold text-ink">{goal.title}</h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              <span>{t(`goals.levels.${goal.level}`)}</span>
              {goal.department && <span>، {goal.department.name}</span>}
              <span>، {goal.owner.displayName}</span>
            </div>
            {showParent && goal.parent && (
              <p className="truncate text-xs text-ink-subtle">
                {t('goals.under', { title: goal.parent.title })}
              </p>
            )}
          </div>
          <GoalStatusBadge goal={goal} />
        </div>
        <ProgressBar
          value={goal.progress}
          size="sm"
          showValue
          label={t('goals.keyResultsCount', { count: formatNumber(goal.keyResultCount) })}
        />
      </Link>
    </Card>
  );
}
