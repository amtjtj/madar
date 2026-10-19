'use client';

import { formatPercent } from '@madar/shared';
import { useId, type ChangeEvent } from 'react';

import { cn } from '../lib/cn.js';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Called when a drag or key press ends (e.g. to save, or for a short haptic tick). */
  onCommit?: (value: number) => void;
  label: string;
  hideLabel?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** What screen readers and the big number say; a percentage by default. */
  valueText?: (value: number) => string;
  className?: string;
}

/**
 * A native range input under a drawn track and thumb (ADR 0018): keyboard (arrows, Home, End,
 * PageUp/Down), touch, mouse and screen readers come from the browser. Fills from the inline
 * start, so 0 is on the right in RTL; the thumb is a 44 px touch target.
 */
export function Slider({
  value,
  onChange,
  onCommit,
  label,
  hideLabel,
  min = 0,
  max = 100,
  step = 5,
  disabled,
  valueText = (v) => formatPercent(v / 100),
  className,
}: SliderProps) {
  const id = useId();
  const share = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const commit = () => {
    if (disabled) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(10);
    onCommit?.(value);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span aria-hidden className="text-2xl font-black text-ink tabular-nums">
          {valueText(value)}
        </span>
      </div>
      <div className={cn('group relative h-11', disabled && 'opacity-50')}>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={valueText(value)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={(e) => {
            if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
              commit();
          }}
          // The native thumb is as wide as the drawn one's touch area (44 px), so a tap lands on the
          // same value the drawn track shows (its ends are inset by half of it).
          className="absolute inset-0 z-10 m-0 w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed [&::-moz-range-thumb]:size-11 [&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none"
        />
        <div className="pointer-events-none absolute inset-x-[22px] top-1/2 h-3 -translate-y-1/2 rounded-full bg-sunken">
          <div
            className="absolute inset-y-0 start-0 rounded-full bg-primary transition-[width] duration-150 ease-out"
            style={{ width: `${share}%` }}
          />
          <div
            className="absolute top-1/2 size-7 -translate-y-1/2 rounded-full border-4 border-primary bg-surface shadow-md transition-[inset-inline-start] duration-150 ease-out group-has-[input:focus-visible]:outline-2 group-has-[input:focus-visible]:outline-offset-2 group-has-[input:focus-visible]:outline-focus"
            style={{ insetInlineStart: `calc(${share}% - 14px)` }}
          />
        </div>
      </div>
    </div>
  );
}
