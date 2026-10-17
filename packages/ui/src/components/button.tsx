'use client';

import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '../lib/cn.js';
import { buttonVariants } from './button-variants.js';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styles. */
  asChild?: boolean;
  /** Shows a pulsing dots indicator and blocks clicks while keeping the label for screen readers. */
  loading?: boolean;
  /** Icon placed at the inline start (right in RTL). */
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  loading = false,
  icon,
  children,
  type,
  ref,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? <LoadingDots /> : icon}
      <span className={cn(loading && 'opacity-80')}>{children}</span>
    </button>
  );
}

function LoadingDots() {
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
