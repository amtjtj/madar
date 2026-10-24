import { t } from '@madar/i18n';
import {
  addDays,
  formatCalendarDate,
  formatNumber,
  persianWeekdayOfCalendarDate,
  type StreakStatus,
  type XpReason,
} from '@madar/shared';
import { Flame, Star } from 'lucide-react';

import { cn } from '../lib/cn.js';
import { ProgressBar } from './progress.js';

/**
 * Gamification pieces (plan phase-3-step-18a, ADR 0029). They only ever show the viewer's own
 * numbers: nothing here compares or ranks people.
 */

export interface StreakFlameProps {
  count: number;
  /** Today already counts (the flame is lit). */
  lit?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}

/** The streak: a flame and the number of days in a row. */
export function StreakFlame({ count, lit = count > 0, size = 'md', className }: StreakFlameProps) {
  return (
    <span
      role="img"
      aria-label={t('ui.gamification.streak', { count: formatNumber(count) })}
      className={cn(
        'inline-flex items-center gap-1.5 font-extrabold tabular-nums',
        size === 'lg' ? 'text-2xl [&_svg]:size-7' : 'text-lg [&_svg]:size-5',
        lit ? 'text-streak' : 'text-ink-subtle',
        className,
      )}
    >
      <Flame aria-hidden className={cn(lit && 'fill-streak-soft')} />
      {formatNumber(count)}
    </span>
  );
}

export interface LevelBarProps {
  level: number;
  /** XP inside the current level and what it spans. */
  into: number;
  span: number;
  className?: string;
}

/** «سطح ۴» with the way to the next level. */
export function LevelBar({ level, into, span, className }: LevelBarProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-sm font-extrabold text-accent-ink [&_svg]:size-4">
        <Star aria-hidden className="fill-accent" />
        {t('ui.gamification.level', { level: formatNumber(level) })}
      </span>
      <ProgressBar
        className="min-w-0 flex-1"
        tone="accent"
        size="sm"
        value={span ? into / span : 0}
        label={t('ui.gamification.toNext', { xp: formatNumber(Math.max(0, span - into)) })}
      />
    </div>
  );
}

const dayStyle: Record<StreakStatus, string> = {
  completed: 'bg-streak border-streak',
  missed: 'bg-sunken border-line',
  excused_leave: 'bg-accent-soft border-accent-edge/40',
  excused_holiday: 'bg-accent-soft border-accent-edge/40',
  off_day: 'bg-transparent border-line border-dashed',
};

export interface StreakMapProps {
  /** Closed days; a day with no entry is drawn empty. */
  days: ReadonlyArray<{ day: string; status: StreakStatus }>;
  /** First and last day shown (whole Saturday-to-Friday weeks look best). */
  from: string;
  to: string;
  className?: string;
}

/** The last weeks as a grid of days, a column per week (Saturday on top), newest at the end. */
export function StreakMap({ days, from, to, className }: StreakMapProps) {
  const byDay = new Map(days.map((d) => [d.day, d.status]));
  let start = from;
  while (persianWeekdayOfCalendarDate(start) !== 0) start = addDays(start, -1);
  const weeks: string[][] = [];
  for (let day = start; day <= to; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label={t('ui.gamification.mapLabel')}>
        {weeks.map((week) => (
          <li key={week[0]} className="flex flex-col gap-1">
            <ol className="flex flex-col gap-1">
              {week.map((day) => {
                const status = day >= from && day <= to ? byDay.get(day) : undefined;
                const label = `${formatCalendarDate(day, 'medium')}: ${
                  status ? t(`ui.gamification.days.${status}`) : t('ui.gamification.days.open')
                }`;
                return (
                  <li
                    key={day}
                    title={label}
                    aria-label={label}
                    className={cn(
                      'size-4 rounded-[4px] border sm:size-5',
                      status
                        ? dayStyle[status]
                        : day <= to
                          ? 'border-line/50 bg-transparent'
                          : 'border-transparent bg-transparent',
                    )}
                  />
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {(['completed', 'missed', 'excused_leave', 'off_day'] as const).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-3 rounded-[3px] border', dayStyle[status])} />
            {t(`ui.gamification.legend.${status}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface XpRowProps {
  amount: number;
  reason: XpReason;
  /** The task's title, when the viewer still sees it. */
  title?: string | null;
  weight?: number | null;
  when: string;
  className?: string;
}

/** One line of «تاریخچه XP». */
export function XpRow({ amount, reason, title, weight, when, className }: XpRowProps) {
  const negative = amount < 0;
  return (
    <div className={cn('flex items-center gap-3 py-2.5', className)}>
      <span
        className={cn(
          'min-w-14 shrink-0 rounded-full px-2 py-0.5 text-center text-sm font-extrabold tabular-nums',
          negative ? 'bg-sunken text-ink-muted' : 'bg-accent-soft text-accent-ink',
        )}
      >
        {negative
          ? t('ui.gamification.xpLost', { xp: formatNumber(-amount) })
          : t('ui.xpGained', { xp: formatNumber(amount) })}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">
          {title
            ? t('ui.gamification.withTitle', {
                reason: t(`ui.gamification.reasons.${reason}`),
                title,
              })
            : t(`ui.gamification.reasons.${reason}`)}
        </span>
        <span className="text-xs text-ink-muted">
          {weight && weight > 1
            ? t('ui.gamification.meta', {
                weight: t('ui.gamification.weight', { weight: formatNumber(weight) }),
                when,
              })
            : when}
        </span>
      </span>
    </div>
  );
}
