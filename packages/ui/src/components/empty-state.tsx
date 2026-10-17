import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Custom illustration; defaults to the Madar orbit. */
  illustration?: ReactNode;
  /** Usually a Button. */
  action?: ReactNode;
  className?: string;
}

/** Designed empty state for lists: what's missing and the next step. */
export function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-10 text-center text-balance',
        className,
      )}
    >
      <div className="mb-2">{illustration ?? <OrbitIllustration />}</div>
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** «مدار» = orbit: a small planet with two moons on their paths. */
export function OrbitIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      className={cn('h-28 w-auto', className)}
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse
        cx="80"
        cy="60"
        rx="70"
        ry="26"
        className="stroke-line-strong"
        strokeWidth="2"
        strokeDasharray="4 7"
      />
      <ellipse cx="80" cy="60" rx="46" ry="46" className="stroke-line" strokeWidth="2" />
      <circle cx="80" cy="60" r="24" className="fill-primary" />
      <path
        d="M64 52a18 18 0 0 1 22-10"
        className="stroke-on-primary"
        strokeOpacity="0.5"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="150" cy="60" r="9" className="fill-accent" />
      <circle cx="148" cy="57" r="3" className="fill-on-accent" fillOpacity="0.25" />
      <circle cx="47" cy="27" r="6" className="fill-streak" />
      <circle cx="30" cy="96" r="2.5" className="fill-ink-subtle" />
      <circle cx="132" cy="18" r="2" className="fill-ink-subtle" />
      <circle cx="120" cy="104" r="3" className="fill-info" />
    </svg>
  );
}
