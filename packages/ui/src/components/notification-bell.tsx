import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { Bell } from 'lucide-react';
import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '../lib/cn.js';

export interface NotificationBellProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Unread notifications; hidden at 0, «۹+» above 9. */
  count: number;
  ref?: Ref<HTMLButtonElement>;
}

/** Bell button with an unread counter. The accessible name includes the count. */
export function NotificationBell({ count, className, ref, ...props }: NotificationBellProps) {
  const shown = count > 9 ? `${formatNumber(9)}+` : formatNumber(count);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={
        count > 0
          ? t('ui.notificationsUnread', { count: formatNumber(count) })
          : t('ui.notifications')
      }
      className={cn(
        'relative grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-5',
        className,
      )}
      {...props}
    >
      <Bell aria-hidden />
      {count > 0 && (
        <span
          key={count}
          aria-hidden
          className="absolute -top-0.5 -end-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[0.6875rem] font-bold text-on-danger ring-2 ring-canvas animate-pop-in"
        >
          {shown}
        </span>
      )}
    </button>
  );
}
