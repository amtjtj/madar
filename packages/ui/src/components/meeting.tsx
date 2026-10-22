import { t } from '@madar/i18n';
import { formatNumber, type MeetingType } from '@madar/shared';
import { CheckSquare, FileText, Gavel, Target, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { Badge } from './badge.js';
import type { LinkComponent } from './navigation.js';

const typeIcon = { regular: Users, okr_review: Target, one_on_one: UserRound } as const;
const typeTone = { regular: 'neutral', okr_review: 'accent', one_on_one: 'info' } as const;

/** «عادی», «بررسی OKR» or «یک‌به‌یک». */
export function MeetingTypeBadge({ type, className }: { type: MeetingType; className?: string }) {
  const Icon = typeIcon[type];
  return (
    <Badge tone={typeTone[type]} className={className}>
      <Icon aria-hidden />
      {t(`meetings.types.${type}`)}
    </Badge>
  );
}

export interface MeetingRowProps {
  href: string;
  title: string;
  type: MeetingType;
  /** Already worded: «ساعت ۱۰:۰۰ تا ۱۱:۰۰», or with the date for past meetings. */
  time: string;
  participantCount: number;
  hasMinutes: boolean;
  canceled: boolean;
  /** Under way right now. */
  live?: boolean;
  Link?: LinkComponent;
  className?: string;
}

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

/** One meeting in a list: time first, a canceled one struck through. */
export function MeetingRow({
  href,
  title,
  type,
  time,
  participantCount,
  hasMinutes,
  canceled,
  live = false,
  Link = DefaultLink,
  className,
}: MeetingRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-16 items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5',
          canceled ? 'bg-sunken text-ink-subtle' : 'bg-primary-soft text-primary-ink',
        )}
      >
        {type === 'one_on_one' ? <UserRound aria-hidden /> : <Users aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate font-medium',
            canceled ? 'text-ink-subtle line-through' : 'text-ink',
          )}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-sm text-ink-muted">{time}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
          {type !== 'regular' && <MeetingTypeBadge type={type} />}
          {live && !canceled && (
            <Badge tone="success" dot>
              {t('meetings.todayCard.now')}
            </Badge>
          )}
          {canceled && <Badge tone="danger">{t('meetings.canceled')}</Badge>}
          {hasMinutes && (
            <Badge tone="primary">
              <FileText aria-hidden />
              {t('meetings.hasMinutes')}
            </Badge>
          )}
          <span className="inline-flex items-center gap-0.5 [&_svg]:size-3.5">
            <Users aria-hidden />
            {t('meetings.participants', { count: formatNumber(participantCount) })}
          </span>
        </span>
      </span>
    </Link>
  );
}

export interface DecisionItemProps {
  text: string;
  /** The key result it serves (OKR reviews). */
  keyResult?: string | null;
  /** The task made from it: a link when the viewer may open it, else only that it exists. */
  task?: { title: string | null; assignee?: string | null; href?: string } | null;
  /** «تبدیل به کار», edit and delete for the people who write the minutes. */
  actions?: ReactNode;
  Link?: LinkComponent;
  className?: string;
}

/** A meeting decision, and the task it became. */
export function DecisionItem({
  text,
  keyResult,
  task,
  actions,
  Link = DefaultLink,
  className,
}: DecisionItemProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-xl border border-line p-3',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4',
          task ? 'bg-success-soft text-success-ink' : 'bg-sunken text-ink-muted',
        )}
      >
        {task ? <CheckSquare aria-hidden /> : <Gavel aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-7 break-words whitespace-pre-line text-ink">{text}</p>
        {(keyResult || task) && (
          <div className="mt-1.5 flex flex-col gap-1 text-sm text-ink-muted">
            {keyResult && (
              <span className="inline-flex items-center gap-1 [&_svg]:size-3.5">
                <Target aria-hidden />
                {t('meetings.decisions.keyResult', { title: keyResult })}
              </span>
            )}
            {task &&
              (task.title && task.href ? (
                <Link
                  href={task.href}
                  className="inline-flex flex-wrap items-center gap-1 font-medium text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {t('meetings.decisions.task', { title: task.title })}
                  {task.assignee && (
                    <span className="font-normal text-ink-muted">
                      ({t('meetings.decisions.assignee', { name: task.assignee })})
                    </span>
                  )}
                </Link>
              ) : (
                <span>{t('meetings.decisions.taskHidden')}</span>
              ))}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex basis-full items-center justify-end gap-1 sm:basis-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
