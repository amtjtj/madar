'use client';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import { cn } from '../lib/cn.js';

const PARTICLES = 10;
const particleColors = ['bg-primary', 'bg-accent', 'bg-streak', 'bg-info'] as const;

export interface CompleteCheckProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** XP shown in the floating chip when completed. */
  xp?: number;
  /** Accessible name, usually the task title. */
  label: string;
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

/**
 * The «task done» moment: the circle pops and fills, the check draws itself,
 * confetti bursts and a «+XP» chip floats away. Feedback lands in ~250ms and never blocks input.
 */
export function CompleteCheck({
  checked,
  onCheckedChange,
  xp,
  label,
  size = 'md',
  disabled,
  className,
}: CompleteCheckProps) {
  const reduceMotion = useReducedMotion();
  const [celebration, setCelebration] = useState(0);

  const toggle = () => {
    const next = !checked;
    onCheckedChange(next);
    if (next) {
      setCelebration((n) => n + 1);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(12);
    }
  };

  const box = size === 'lg' ? 'size-9' : 'size-7';

  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', className)}>
      <motion.button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${label} — ${checked ? t('ui.markIncomplete') : t('ui.markComplete')}`}
        disabled={disabled}
        onClick={toggle}
        // Always pass whileTap (motion adds tabindex for it) so server and client markup match.
        whileTap={{ scale: reduceMotion ? 1 : 0.85 }}
        animate={
          checked && !reduceMotion && celebration > 0 ? { scale: [1, 1.2, 1] } : { scale: 1 }
        }
        transition={{ duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
        className={cn(
          'relative grid place-items-center rounded-full border-2 transition-colors duration-(--duration-fast)',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50',
          box,
          checked
            ? 'border-primary bg-primary text-on-primary shadow-[0_2px_0_var(--primary-edge)]'
            : 'border-line-strong bg-surface text-transparent hover:border-primary hover:bg-primary-soft',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" aria-hidden>
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut', delay: 0.04 }}
          />
        </svg>
      </motion.button>

      <AnimatePresence>
        {checked && celebration > 0 && !reduceMotion && (
          <span key={celebration} aria-hidden className="pointer-events-none absolute inset-0">
            {Array.from({ length: PARTICLES }, (_, i) => {
              const angle = (i / PARTICLES) * Math.PI * 2;
              const distance = size === 'lg' ? 34 : 28;
              return (
                <motion.span
                  key={i}
                  className={cn(
                    'absolute top-1/2 start-1/2 -mt-1 -ms-1 size-2 rounded-full',
                    particleColors[i % particleColors.length],
                    i % 3 === 0 && 'rounded-[2px]',
                  )}
                  initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
                  animate={{
                    x: Math.cos(angle) * distance,
                    y: Math.sin(angle) * distance,
                    scale: [0.4, 1, 0.6],
                    opacity: [1, 1, 0],
                  }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
              );
            })}
            {xp ? (
              <motion.span
                className="absolute bottom-full start-1/2 -ms-8 w-16 text-center text-xs font-extrabold whitespace-nowrap text-accent-ink"
                initial={{ y: 4, opacity: 0, scale: 0.8 }}
                animate={{ y: -18, opacity: [0, 1, 1, 0], scale: 1 }}
                transition={{ duration: 0.9, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
              >
                {t('ui.xpGained', { xp: formatNumber(xp) })}
              </motion.span>
            ) : null}
          </span>
        )}
      </AnimatePresence>
    </span>
  );
}
