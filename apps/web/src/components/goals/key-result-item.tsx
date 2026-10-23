'use client';

import { ChevronDown, ListTodo } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, type KeyResult } from '@madar/shared';
import { Badge, ProgressBar, cn } from '@madar/ui';

import { formatKrProgress, statusTone } from '@/lib/goals';

import { CheckinHistory } from './checkin-history';
import { CheckinSheet } from './checkin-sheet';

export function KeyResultItem({
  goalId,
  kr,
  canCheckIn,
}: {
  goalId: string;
  kr: KeyResult;
  /** The owner and whoever defines the goal record progress (plan phase-3-step-17a). */
  canCheckIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { done, total } = kr.linked.tasks;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-bold text-ink">{kr.title}</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="tabular-nums">{formatKrProgress(kr)}</span>
            <Badge tone={statusTone(kr.status)} dot={kr.status !== null}>
              {kr.status ? t(`goals.statuses.${kr.status}`) : t('goals.noStatus')}
            </Badge>
          </div>
        </div>
        {canCheckIn && <CheckinSheet goalId={goalId} kr={kr} />}
      </div>
      <ProgressBar value={kr.progress} size="sm" showValue />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        {total > 0 || kr.linked.projects > 0 ? (
          <span className="flex items-center gap-1 [&_svg]:size-3.5">
            <ListTodo aria-hidden />
            {total > 0 &&
              t('goals.detail.linkedTasks', {
                done: formatNumber(done),
                total: formatNumber(total),
              })}
            {total > 0 && kr.linked.projects > 0 && '، '}
            {kr.linked.projects > 0 &&
              t('goals.detail.linkedProjects', { count: formatNumber(kr.linked.projects) })}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-ink-muted hover:bg-sunken [&_svg]:size-4"
        >
          {t('goals.detail.history')}
          <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && <CheckinHistory kr={kr} />}
    </li>
  );
}
