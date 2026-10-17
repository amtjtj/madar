'use client';

import { Check } from 'lucide-react';
import { useId, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
}

/** Checkbox with a label and optional description; the whole row is clickable. */
export function CheckboxField({ label, description, id, className, ...props }: CheckboxFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-sunken has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
    >
      <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
        <input
          id={inputId}
          type="checkbox"
          className="peer size-5 appearance-none rounded-md border-2 border-line-strong bg-surface transition-colors checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          {...props}
        />
        <Check
          aria-hidden
          className="pointer-events-none absolute size-3.5 text-on-primary opacity-0 peer-checked:opacity-100"
          strokeWidth={3.5}
        />
      </span>
      <span className="flex flex-col">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="text-sm text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}
