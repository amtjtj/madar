'use client';

import { Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { EmptyState, NotificationBell, Popover, Skeleton } from '@madar/ui';

import { useMarkAllRead, useNotifications, useUnreadCount } from '@/hooks/notifications';

import { NotificationRows } from './notification-list';

/** Desktop: the bell opens a panel with the latest notifications. */
export function NotificationPopover() {
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount();
  const { data, isPending } = useNotifications(open);
  const markAll = useMarkAllRead();
  const items = data?.pages[0]?.items.slice(0, 8) ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('notifications.title')}
      className="flex w-[min(24rem,calc(100vw-1.5rem))] flex-col"
      trigger={<NotificationBell count={unread} />}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-bold text-ink">{t('notifications.title')}</h2>
        <div className="flex items-center gap-1">
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="rounded-md px-2 py-1 text-sm font-semibold text-primary-ink hover:bg-primary-soft"
            >
              {t('notifications.markAll')}
            </button>
          )}
          <Link
            href="/settings/notifications"
            onClick={() => setOpen(false)}
            aria-label={t('notifications.settings')}
            className="grid size-8 place-items-center rounded-full text-ink-muted hover:bg-sunken [&_svg]:size-4"
          >
            <Settings aria-hidden />
          </Link>
        </div>
      </div>
      <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-1.5">
        {isPending ? (
          <div className="flex flex-col gap-2 p-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={t('notifications.emptyTitle')}
            description={t('notifications.emptyDescription')}
          />
        ) : (
          <NotificationRows items={items} onOpen={() => setOpen(false)} />
        )}
      </div>
      <Link
        href="/notifications"
        onClick={() => setOpen(false)}
        className="border-t border-line px-4 py-3 text-center text-sm font-semibold text-primary-ink hover:bg-sunken"
      >
        {t('notifications.seeAll')}
      </Link>
    </Popover>
  );
}

/** Mobile: the bell opens the notifications page. */
export function NotificationLink() {
  const { data: unread = 0 } = useUnreadCount();
  const router = useRouter();
  return <NotificationBell count={unread} onClick={() => router.push('/notifications')} />;
}
