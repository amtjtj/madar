import { cva, type VariantProps } from 'class-variance-authority';
import { t } from '@madar/i18n';
import { Lock } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-ink-muted',
        primary: 'bg-primary-soft text-primary-ink',
        success: 'bg-success-soft text-success-ink',
        warning: 'bg-warning-soft text-warning-ink',
        danger: 'bg-danger-soft text-danger-ink',
        info: 'bg-info-soft text-info-ink',
        accent: 'bg-accent-soft text-accent-ink',
      },
      size: {
        sm: 'h-6 px-2.5 text-xs',
        md: 'h-7 px-3 text-sm',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Leading colored dot (status indicator). */
  dot?: boolean;
}

/** Small label for status, priority and counts. */
export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const tierStyles = {
  bronze: {
    ring: 'from-[oklch(72%_0.11_55)] to-[oklch(55%_0.1_45)]',
    face: 'bg-[oklch(88%_0.06_60)] text-[oklch(40%_0.09_45)]',
  },
  silver: {
    ring: 'from-[oklch(86%_0.01_258)] to-[oklch(66%_0.015_258)]',
    face: 'bg-[oklch(95%_0.005_258)] text-[oklch(40%_0.02_258)]',
  },
  gold: {
    ring: 'from-accent to-accent-edge',
    face: 'bg-accent-soft text-accent-ink',
  },
} as const;

export interface AchievementBadgeProps {
  label: string;
  icon: ReactNode;
  tier?: keyof typeof tierStyles;
  /** Not earned yet: shown desaturated with a lock. */
  locked?: boolean;
  className?: string;
}

/** Gamification badge («نشان») earned for skills and milestones. */
export function AchievementBadge({
  label,
  icon,
  tier = 'gold',
  locked = false,
  className,
}: AchievementBadgeProps) {
  const style = tierStyles[tier];
  return (
    <figure className={cn('flex w-24 flex-col items-center gap-2 text-center', className)}>
      <div
        className={cn(
          'relative grid size-18 place-items-center rounded-[1.6rem] bg-linear-to-b p-1 shadow-md',
          'rotate-0 transition-transform duration-(--duration-base) ease-(--ease-spring) hover:-rotate-6 hover:scale-105',
          locked ? 'from-line-strong to-line grayscale' : style.ring,
        )}
      >
        <div
          className={cn(
            'grid size-full place-items-center rounded-[1.35rem] [&_svg]:size-8',
            locked ? 'bg-sunken text-ink-subtle' : style.face,
          )}
        >
          {icon}
        </div>
        {locked && (
          <span
            aria-label={t('ui.locked')}
            className="absolute -bottom-1 -end-1 grid size-6 place-items-center rounded-full bg-surface text-ink-subtle shadow-sm [&_svg]:size-3.5"
          >
            <Lock aria-hidden />
          </span>
        )}
      </div>
      <figcaption
        className={cn('text-xs font-semibold leading-5', locked ? 'text-ink-subtle' : 'text-ink')}
      >
        {label}
      </figcaption>
    </figure>
  );
}
