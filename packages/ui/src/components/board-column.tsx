import { t } from '@madar/i18n';
import { formatNumber, type StatusCategory, type StatusColor } from '@madar/shared';
import type { ReactNode, Ref } from 'react';

import { cn } from '../lib/cn.js';
import { statusColorDot, statusDot } from './task-meta.js';

export interface BoardColumnProps {
  title: string;
  category: StatusCategory;
  /** A department status colour (plan phase-3-step-19a); defaults to the category's dot. */
  color?: StatusColor;
  count: number;
  children?: ReactNode;
  /** Shown under the cards (e.g. quick add). */
  footer?: ReactNode;
  /** A card is being dragged over this column. */
  highlighted?: boolean;
  /** Ref for the drop area (drag and drop lives in the app). */
  bodyRef?: Ref<HTMLDivElement>;
  className?: string;
}

/** One status column of a board. Scrolls on its own; snaps horizontally on mobile. */
export function BoardColumn({
  title,
  category,
  color,
  count,
  children,
  footer,
  highlighted,
  bodyRef,
  className,
}: BoardColumnProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex w-[min(85vw,20rem)] shrink-0 snap-start flex-col rounded-2xl bg-sunken p-2 md:w-72',
        className,
      )}
    >
      <header className="flex items-center gap-2 px-2 py-2">
        <span aria-hidden className={cn('size-2.5 rounded-full', color ? statusColorDot[color] : statusDot[category])} />
        <h3 className="font-bold text-ink">{title}</h3>
        <span className="rounded-full bg-surface px-2 text-xs font-semibold text-ink-muted">
          {formatNumber(count)}
        </span>
      </header>
      <div
        ref={bodyRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-1 transition-colors duration-(--duration-fast)',
          highlighted && 'bg-primary-soft',
        )}
      >
        {children}
        {count === 0 && (
          <p className="grid flex-1 place-items-center py-6 text-sm text-ink-subtle">
            {t('work.emptyColumn')}
          </p>
        )}
      </div>
      {footer}
    </section>
  );
}
