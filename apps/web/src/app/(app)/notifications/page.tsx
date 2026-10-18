'use client';

import { CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { Button, Card, EmptyState, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { NotificationRows } from '@/components/notifications/notification-list';
import { useMarkAllRead, useNotifications, useUnreadCount } from '@/hooks/notifications';

export default function NotificationsPage() {
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useNotifications();
  const { data: unread = 0 } = useUnreadCount();
  const markAll = useMarkAllRead();
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        action={
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<CheckCheck aria-hidden />}
                onClick={() => markAll.mutate()}
              >
                {t('notifications.markAll')}
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings/notifications" aria-label={t('notifications.settings')}>
                <Settings aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />
      <Card className="p-1.5">
        {isPending ? (
          <div className="flex flex-col gap-2 p-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={t('notifications.emptyTitle')}
            description={t('notifications.emptyDescription')}
          />
        ) : (
          <NotificationRows items={items} />
        )}
      </Card>
      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {t('notifications.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}
