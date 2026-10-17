import type { HTMLAttributes, Ref } from 'react';

import { cn } from '../lib/cn.js';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts on hover and press; use when the whole card is clickable. */
  interactive?: boolean;
  ref?: Ref<HTMLDivElement>;
}

export function Card({ className, interactive, ref, ...props }: CardProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col rounded-xl border border-line bg-surface shadow-sm',
        interactive &&
          'cursor-pointer transition-[transform,box-shadow] duration-(--duration-base) ease-(--ease-out-quart) hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-bold text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-ink-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-3 border-t border-line px-5 py-3', className)}
      {...props}
    />
  );
}
