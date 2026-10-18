import Link from 'next/link';

import type { GoalBrief } from '@madar/shared';
import { ProgressBar } from '@madar/ui';

import { GoalStatusBadge } from '@/components/goals/goal-card';

/** Compact goal rows for the dashboards: title, progress, status. */
export function GoalRows({ goals }: { goals: GoalBrief[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {goals.map((goal) => (
        <li key={goal.id}>
          <Link
            href={`/goals/${goal.id}`}
            className="flex flex-col gap-2 rounded-lg px-2 py-3 hover:bg-sunken"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-ink">{goal.title}</span>
              <GoalStatusBadge goal={goal} />
            </div>
            <ProgressBar value={goal.progress} size="sm" showValue />
          </Link>
        </li>
      ))}
    </ul>
  );
}
