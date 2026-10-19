import { formatPercent } from '@madar/shared';
import { t } from '@madar/i18n';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

type Tone = 'primary' | 'accent' | 'streak' | 'info';

const fillByTone: Record<Tone, string> = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  streak: 'bg-streak',
  info: 'bg-info',
};

const strokeByTone: Record<Tone, string> = {
  primary: 'stroke-primary',
  accent: 'stroke-accent',
  streak: 'stroke-streak',
  info: 'stroke-info',
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export interface ProgressBarProps {
  /** Progress from 0 to 1. */
  value: number;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  /** Show the percentage next to the label. */
  showValue?: boolean;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  className?: string;
}

/** Linear progress. Fills from the inline start (right in RTL) with a soft highlight stripe. */
export function ProgressBar({
  value,
  tone = 'primary',
  size = 'md',
  label,
  showValue = false,
  hideLabel = false,
  className,
}: ProgressBarProps) {
  const ratio = clamp01(value);
  const percent = formatPercent(ratio);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || showValue) && !hideLabel && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {label && <span className="font-medium text-ink">{label}</span>}
          {showValue && (
            <span className="font-semibold text-ink-muted tabular-nums">{percent}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={t('ui.progress', { value: percent })}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-sunken',
          size === 'sm' && 'h-2',
          size === 'md' && 'h-3.5',
          size === 'lg' && 'h-5',
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 start-0 rounded-full transition-[width] duration-(--duration-slow) ease-(--ease-out-quart)',
            fillByTone[tone],
          )}
          style={{ width: `${ratio * 100}%` }}
        >
          {size !== 'sm' && ratio > 0.04 && (
            <span className="absolute inset-x-2 top-[22%] h-[26%] rounded-full bg-white/35" />
          )}
        </div>
      </div>
    </div>
  );
}

export interface ProgressRingProps {
  value: number;
  tone?: Tone;
  /** Diameter in pixels. */
  size?: number;
  strokeWidth?: number;
  label?: string;
  /** Content in the middle; defaults to the percentage. */
  children?: ReactNode;
  className?: string;
}

/** Circular progress for goals and the daily plan. */
export function ProgressRing({
  value,
  tone = 'primary',
  size = 88,
  strokeWidth = 9,
  label,
  children,
  className,
}: ProgressRingProps) {
  const ratio = clamp01(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-sunken"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn(
            'transition-[stroke-dashoffset] duration-(--duration-slow) ease-(--ease-out-quart)',
            strokeByTone[tone],
          )}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-ink tabular-nums">
        {children ?? formatPercent(ratio)}
      </span>
    </div>
  );
}
