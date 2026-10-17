import type { ReactNode } from 'react';

import { cn } from '@madar/ui';

export function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('flex scroll-mt-24 flex-col gap-4', className)}
    >
      <h2 id={`${id}-title`} className="text-xl font-extrabold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-5 shadow-xs', className)}>
      {children}
    </div>
  );
}

/** Token name shown in code style (Latin, left-to-right). */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code dir="ltr" className="font-mono text-xs text-ink-subtle">
      {children}
    </code>
  );
}
