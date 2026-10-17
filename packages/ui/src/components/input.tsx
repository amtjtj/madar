'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

import { t } from '@madar/i18n';

import { cn } from '../lib/cn.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  /** Error message; marks the field invalid and replaces the hint. */
  error?: string;
  /** Icon at the inline start of the field. */
  icon?: ReactNode;
  /** Control at the inline end of the field (e.g. show/hide password). */
  trailing?: ReactNode;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** Labelled text input with hint, error and optional icon. */
export function TextField({
  label,
  hint,
  error,
  icon,
  trailing,
  hideLabel,
  id,
  className,
  required,
  ref,
  ...props
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={inputId}
          className={cn('text-sm font-medium text-ink', hideLabel && 'sr-only')}
        >
          {label}
          {required && (
            <span className="ms-1 text-danger" aria-label={t('ui.required')}>
              *
            </span>
          )}
        </label>
      )}
      {/* Same direction as the input, so start/end icons and padding line up (e.g. dir="ltr"). */}
      <div className="relative" dir={props.dir}>
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-subtle [&_svg]:size-5">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            'h-12 w-full rounded-lg border-2 border-line bg-surface px-4 text-base text-ink',
            'placeholder:text-ink-subtle transition-colors duration-(--duration-fast)',
            'hover:border-line-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-soft',
            'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
            'aria-invalid:border-danger aria-invalid:focus:ring-danger-soft',
            icon && 'ps-11',
            trailing && 'pe-12',
          )}
          {...props}
        />
        {trailing && (
          <span className="absolute inset-y-0 end-1.5 flex items-center">{trailing}</span>
        )}
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
