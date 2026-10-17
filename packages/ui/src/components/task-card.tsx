'use client';

import { t } from '@madar/i18n';
import { dueStatus, formatCalendarDate, formatNumber, type TaskPriority } from '@madar/shared';
import { CalendarDays, Flag, FolderKanban, ListChecks, MessageCircle } from 'lucide-react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '../lib/cn.js';
import { Avatar } from './avatar.js';
import { Badge } from './badge.js';
import { CompleteCheck } from './complete-check.js';
import { dueTone, priorityTone } from './task-meta.js';

export interface TaskCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string;
  done: boolean;
  /** Omit to hide the check (e.g. no permission to edit). */
  onDoneChange?: (done: boolean) => void;
  /** Opens the task (title becomes a button). */
  onOpen?: () => void;
  priority?: TaskPriority;
  dueOn?: string | null;
  /** Today in the tenant time zone, for due-date wording. */
  today: string;
  assigneeName?: string | null;
  projectName?: string | null;
  subtasks?: { done: number; total: number };
  commentCount?: number;
  /** XP shown when completed. */
  xp?: number;
  /** Extra label such as «از دیروز». */
  tag?: ReactNode;
  /** Trailing action (e.g. «به امروز اضافه کن»). */
  action?: ReactNode;
  /** Lifted while being dragged on a board. */
  dragging?: boolean;
  compact?: boolean;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** A task row/card used in Today, lists and board columns. */
export function TaskCard({
  title,
  done,
  onDoneChange,
  onOpen,
  priority = 'normal',
  dueOn,
  today,
  assigneeName,
  projectName,
  subtasks,
  commentCount,
  xp,
  tag,
  action,
  dragging,
  compact,
  className,
  ref,
  ...rest
}: TaskCardProps) {
  const due = dueOn ? dueStatus(dueOn, today) : null;
  const titleClass = cn(
    'text-start font-semibold leading-6 text-ink transition-colors',
    done && 'text-ink-subtle line-through decoration-2',
  );

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-start gap-3 rounded-xl border border-line bg-surface shadow-xs transition-shadow duration-(--duration-fast)',
        compact ? 'p-2.5' : 'p-3',
        dragging && 'rotate-1 shadow-lg ring-2 ring-primary',
        className,
      )}
      {...rest}
    >
      {onDoneChange ? (
        <CompleteCheck checked={done} onCheckedChange={onDoneChange} label={title} xp={xp} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              titleClass,
              'rounded-sm hover:text-primary-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            {title}
          </button>
        ) : (
          <span className={titleClass}>{title}</span>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          {tag}
          {due && dueOn && !done ? (
            <Badge tone={dueTone[due]}>
              <CalendarDays aria-hidden />
              {t(`work.due.${due}`, { date: formatCalendarDate(dueOn) })}
            </Badge>
          ) : null}
          {priority === 'high' || priority === 'urgent' ? (
            <Badge tone={priorityTone[priority]}>
              <Flag aria-hidden />
              {t(`work.priority.${priority}`)}
            </Badge>
          ) : null}
          {projectName ? (
            <span className="inline-flex min-w-0 items-center gap-1 [&_svg]:size-3.5">
              <FolderKanban aria-hidden className="shrink-0" />
              <span className="truncate">{projectName}</span>
            </span>
          ) : null}
          {subtasks && subtasks.total > 0 ? (
            <span className="inline-flex items-center gap-1 [&_svg]:size-3.5">
              <ListChecks aria-hidden />
              {t('work.subtasks', {
                done: formatNumber(subtasks.done),
                total: formatNumber(subtasks.total),
              })}
            </span>
          ) : null}
          {commentCount ? (
            <span className="inline-flex items-center gap-1 [&_svg]:size-3.5">
              <MessageCircle aria-hidden />
              {t('work.comments', { count: formatNumber(commentCount) })}
            </span>
          ) : null}
        </div>
      </div>
      {action}
      {assigneeName ? <Avatar name={assigneeName} size="xs" className="mt-0.5" /> : null}
    </div>
  );
}

export interface PriorityBadgeProps {
  priority: TaskPriority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <Badge tone={priorityTone[priority]} className={className}>
      <Flag aria-hidden />
      {t(`work.priority.${priority}`)}
    </Badge>
  );
}
