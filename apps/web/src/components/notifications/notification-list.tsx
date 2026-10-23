'use client';

import {
  AlarmClock,
  CalendarClock,
  CalendarX,
  FileText,
  FolderKanban,
  Forward,
  Mail,
  MessageCircle,
  Stamp,
  UserPlus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import { formatRelativeTime, type Notification } from '@madar/shared';
import { Avatar, UrgencyBadge, cn } from '@madar/ui';

import { useMarkRead } from '@/hooks/notifications';
import { useMe } from '@/hooks/use-me';
import { notificationHref, notificationText } from '@/lib/notification-text';

const kindIcon: Partial<Record<Notification['kind'], typeof AlarmClock>> = {
  task_commented: MessageCircle,
  letter_received: Mail,
  letter_referred: Forward,
  task_evidence_pinned: Stamp,
  task_due_soon: AlarmClock,
  task_overdue: AlarmClock,
  task_overdue_escalation: AlarmClock,
  project_member_added: FolderKanban,
  task_assigned: UserPlus,
  meeting_invited: CalendarClock,
  meeting_changed: CalendarClock,
  meeting_canceled: CalendarX,
  meeting_minutes: FileText,
  meeting_reminder: AlarmClock,
};

/** Notification rows: tap marks it read and opens the task or project. */
export function NotificationRows({
  items,
  onOpen,
}: {
  items: Notification[];
  /** Called after navigating (e.g. to close a popover). */
  onOpen?: () => void;
}) {
  const router = useRouter();
  const markRead = useMarkRead();
  const { data: me } = useMe();
  return (
    <ul className="flex flex-col">
      {items.map((n) => {
        const Icon = kindIcon[n.kind] ?? UserPlus;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id);
                router.push(notificationHref(n));
                onOpen?.();
              }}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors hover:bg-sunken',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
              )}
            >
              <span className="relative shrink-0">
                {n.actor ? (
                  <Avatar name={n.actor.displayName} size="md" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-warning-soft text-warning-ink [&_svg]:size-5">
                    <Icon aria-hidden />
                  </span>
                )}
                {n.actor && (
                  <span className="absolute -bottom-0.5 -end-0.5 grid size-5 place-items-center rounded-full bg-surface text-ink-muted ring-2 ring-surface [&_svg]:size-3">
                    <Icon aria-hidden />
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    'leading-6',
                    n.readAt ? 'text-ink-muted' : 'font-semibold text-ink',
                  )}
                >
                  {notificationText(n, me?.tenant?.timezone)}
                </span>
                <span className="flex items-center gap-2">
                  {(n.data.urgency === 'urgent' || n.data.urgency === 'immediate') && (
                    <UrgencyBadge urgency={n.data.urgency} />
                  )}
                  <time dateTime={n.createdAt} className="text-xs text-ink-subtle">
                    {formatRelativeTime(new Date(n.createdAt))}
                  </time>
                </span>
              </span>
              {!n.readAt && (
                <span
                  className="mt-2 size-2.5 shrink-0 rounded-full bg-primary"
                  role="img"
                  aria-label={t('notifications.unread')}
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
