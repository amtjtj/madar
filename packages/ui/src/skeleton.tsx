import { cx } from './cx.js';

export interface SkeletonProps {
  className?: string;
}

/** Placeholder block shown while data loads (we use skeletons, never spinners). */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-current/10', className)} />;
}
