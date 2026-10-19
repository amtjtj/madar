'use client';

import { t } from '@madar/i18n';
import type { RankReason } from '@madar/shared';
import { BadgeCheck, Info, Send, User, Users } from 'lucide-react';

import { cn } from '../lib/cn.js';
import { Badge } from './badge.js';
import { Popover } from './popover.js';
import { rankText, sourceLabel, type TaskSourceInfo } from './task-source-text.js';

export interface SourceBadgeProps {
  source: TaskSourceInfo;
  /** «ابلاغ از طرف مریم احمدی، مدیر پشتیبانی» instead of the short card label. */
  full?: boolean;
  className?: string;
}

/**
 * Where a task came from. Assignments from the CEO stand out with a calm primary tone and a check,
 * never a warning color (feedback 1405-07-27 §1).
 */
export function SourceBadge({ source, full, className }: SourceBadgeProps) {
  const ceo = source.kind === 'assigned' && source.ceo;
  const tone = ceo ? 'primary' : source.kind === 'assigned' ? 'info' : 'neutral';
  const Icon = ceo
    ? BadgeCheck
    : source.kind === 'assigned'
      ? Send
      : source.kind === 'personal'
        ? User
        : Users;
  return (
    <Badge tone={tone} className={cn('max-w-full', className)}>
      <Icon aria-hidden />
      <span className="truncate">{sourceLabel(source, full)}</span>
    </Badge>
  );
}

export interface RankHintProps {
  reasons: readonly RankReason[];
  className?: string;
}

/** «چرا این‌جا؟»: an info button (tap on phones, hover or focus on desktop) with the reasons. */
export function RankHint({ reasons, className }: RankHintProps) {
  const text = rankText(reasons);
  return (
    <Popover
      label={t('work.rank.label')}
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`${t('work.rank.label')} ${text}`}
          title={text}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-3.5',
            className,
          )}
        >
          <Info aria-hidden />
        </button>
      }
    >
      <p className="max-w-60 text-sm text-ink">
        <span className="font-semibold">{t('work.rank.label')}</span> {text}
      </p>
    </Popover>
  );
}
