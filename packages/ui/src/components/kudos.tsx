import { t } from '@madar/i18n';
import {
  BADGES,
  formatNumber,
  type BadgeKey,
  type BadgeTier,
  type ValueTag,
  VALUE_TAGS,
} from '@madar/shared';
import {
  Award,
  CheckCheck,
  Clock,
  Flame,
  Gift,
  Gauge,
  GraduationCap,
  Handshake,
  Heart,
  HeartHandshake,
  Lightbulb,
  Lock,
  Medal,
  Rocket,
  Sparkles,
  Star,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { Avatar } from './avatar.js';
import { AchievementBadge } from './badge.js';
import { ProgressBar } from './progress.js';

/**
 * Kudos and badges (plan phase-3-step-18b). Recognition only: nothing here counts, compares or
 * orders people.
 */

const tagIcon: Record<ValueTag, typeof Heart> = {
  teamwork: Handshake,
  help: HeartHandshake,
  quality: Sparkles,
  speed: Zap,
  learning: GraduationCap,
  initiative: Lightbulb,
};

export function ValueTagIcon({ tag }: { tag: ValueTag }) {
  const Icon = tagIcon[tag];
  return <Icon aria-hidden />;
}

export interface ValueTagPickerProps {
  value: ValueTag | null;
  onChange: (tag: ValueTag) => void;
  label: string;
}

/** The six value tags as large toggle buttons (one choice). */
export function ValueTagPicker({ value, onChange, label }: ValueTagPickerProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {VALUE_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={value === tag}
            onClick={() => onChange(tag)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-xl border p-2.5 text-sm font-semibold transition-colors [&_svg]:size-5',
              value === tag
                ? 'border-primary-edge bg-primary-soft text-primary-ink'
                : 'border-line bg-surface text-ink-muted hover:bg-sunken',
            )}
          >
            <ValueTagIcon tag={tag} />
            {t(`ui.gamification.valueTags.${tag}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface KudosCardProps {
  from: string;
  to: string;
  tag: ValueTag;
  message: string;
  taskTitle?: string | null;
  when: string;
  private?: boolean;
  /** Extra controls (e.g. «پنهان کردن»). */
  actions?: ReactNode;
  className?: string;
}

/** One thanks: who to whom, the value, the message and (if visible) the task. */
export function KudosCard({
  from,
  to,
  tag,
  message,
  taskTitle,
  when,
  private: isPrivate,
  actions,
  className,
}: KudosCardProps) {
  return (
    <article className={cn('flex gap-3 py-3', className)}>
      <Avatar name={from} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">
            {t('ui.gamification.kudosFrom', { from, to })}
          </span>
        </p>
        <p className="text-ink">{message}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-ink [&_svg]:size-3.5">
            <ValueTagIcon tag={tag} />
            {t(`ui.gamification.valueTags.${tag}`)}
          </span>
          {taskTitle && <span>{t('ui.gamification.kudosTask', { title: taskTitle })}</span>}
          {isPrivate && (
            <span className="inline-flex items-center gap-1 [&_svg]:size-3.5">
              <Lock aria-hidden />
              {t('ui.gamification.kudosPrivate')}
            </span>
          )}
          <span>{when}</span>
        </div>
      </div>
      {actions}
    </article>
  );
}

const badgeIcon: Record<BadgeKey, typeof Heart> = {
  first_task: CheckCheck,
  tasks_10: Medal,
  tasks_50: Award,
  tasks_100: Trophy,
  on_time_25: Clock,
  streak_5: Flame,
  streak_20: Flame,
  streak_60: Rocket,
  kudos_5: Heart,
  kudos_25: Star,
  generous_10: Gift,
  goals_12: Target,
  level_5: Gauge,
  level_10: Trophy,
  first_thanks: HeartHandshake,
};

export interface BadgeGridItem {
  key: BadgeKey;
  tier: BadgeTier;
  earned: boolean;
  /** Progress towards a badge not earned yet (shown to its owner only). */
  value?: number;
  goal?: number;
}

/** Badges in catalog order; locked ones show their way there when `value`/`goal` are given. */
export function BadgeGrid({ items, className }: { items: BadgeGridItem[]; className?: string }) {
  const order = new Map(BADGES.map((b, i) => [b.key, i]));
  const sorted = [...items].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  return (
    <ul className={cn('grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-5', className)}>
      {sorted.map((b) => {
        const Icon = badgeIcon[b.key];
        return (
          <li
            key={b.key}
            className="flex flex-col items-center gap-1"
            title={t(`ui.gamification.badges.${b.key}.hint`)}
          >
            <AchievementBadge
              label={t(`ui.gamification.badges.${b.key}.name`)}
              icon={<Icon aria-hidden />}
              tier={b.tier}
              locked={!b.earned}
            />
            {!b.earned && b.goal !== undefined && b.value !== undefined && (
              <div className="flex w-20 flex-col gap-0.5">
                <ProgressBar
                  size="sm"
                  tone="accent"
                  value={b.goal ? b.value / b.goal : 0}
                  hideLabel
                  label={t(`ui.gamification.badges.${b.key}.hint`)}
                />
                <span className="text-center text-[11px] text-ink-muted tabular-nums">
                  {t('ui.gamification.badgeProgress', {
                    value: formatNumber(b.value),
                    goal: formatNumber(b.goal),
                  })}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
