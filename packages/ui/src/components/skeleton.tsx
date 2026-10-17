import { cn } from '../lib/cn.js';

export interface SkeletonProps {
  className?: string;
}

/** Placeholder block shown while data loads (we use skeletons, never spinners). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--sunken)_25%,var(--line)_50%,var(--sunken)_75%)] bg-size-[200%_100%]',
        className,
      )}
    />
  );
}

/** Several text-like lines; the last one is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
