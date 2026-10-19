'use client';

import { ChevronDown } from 'lucide-react';
import { useId, type Ref, type SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children'
> {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/** Native select (best on mobile) styled like TextField. */
export function SelectField({
  label,
  options,
  hint,
  error,
  hideLabel,
  id,
  className,
  ref,
  ...props
}: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={selectId}
        className={cn('text-sm font-medium text-ink', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            'h-12 w-full appearance-none rounded-lg border-2 border-line bg-surface ps-4 pe-10 text-base text-ink',
            'transition-colors duration-(--duration-fast) hover:border-line-strong',
            'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-soft',
            'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70 aria-invalid:border-danger',
          )}
          {...props}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute inset-y-0 end-3 my-auto size-5 text-ink-subtle"
        />
      </div>
      {message && (
        <p
          id={messageId}
          className={cn('text-sm', error ? 'font-medium text-danger-ink' : 'text-ink-muted')}
        >
          {message}
        </p>
      )}
    </div>
  );
}
