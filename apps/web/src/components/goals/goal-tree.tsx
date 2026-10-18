'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import type { GoalSummary } from '@madar/shared';
import { cn } from '@madar/ui';

import { GoalCard } from './goal-card';

/** The company's goals as an alignment tree (roots: goals whose parent is not in the list). */
export function GoalTree({ goals }: { goals: GoalSummary[] }) {
  const ids = new Set(goals.map((g) => g.id));
  const roots = goals.filter((g) => !g.parent || !ids.has(g.parent.id));
  return (
    <ul className="flex flex-col gap-3" role="tree" aria-label={t('goals.views.company')}>
      {roots.map((goal) => (
        <TreeNode key={goal.id} goal={goal} goals={goals} depth={0} />
      ))}
    </ul>
  );
}

function TreeNode({
  goal,
  goals,
  depth,
}: {
  goal: GoalSummary;
  goals: GoalSummary[];
  depth: number;
}) {
  const children = goals.filter((g) => g.parent?.id === goal.id);
  const [open, setOpen] = useState(depth < 1);
  return (
    <li
      role="treeitem"
      aria-expanded={children.length ? open : undefined}
      aria-selected={false}
      className="flex flex-col gap-2"
    >
      <div className="flex items-start gap-1">
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={t(open ? 'goals.collapse' : 'goals.expand', { title: goal.title })}
            className="mt-4 grid size-7 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-sunken [&_svg]:size-4"
          >
            <ChevronDown aria-hidden className={cn('transition-transform', !open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        )}
        <GoalCard goal={goal} showParent={false} className="min-w-0 flex-1" />
      </div>
      {children.length > 0 && open && (
        <ul
          role="group"
          className="ms-3 flex flex-col gap-2 border-s-2 border-line ps-1 md:ms-4 md:ps-4"
        >
          {children.map((child) => (
            <TreeNode key={child.id} goal={child} goals={goals} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
