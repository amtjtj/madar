import { t } from '@madar/i18n';
import { formatCalendarDate, formatNumber, type Notification } from '@madar/shared';

/** The Persian sentence for a notification (all text from i18n). */
export function notificationText(n: Notification): string {
  const actor = n.actor?.displayName ?? t('notifications.someone');
  const date = typeof n.data.dueOn === 'string' ? formatCalendarDate(n.data.dueOn) : '';
  const days = typeof n.data.days === 'number' ? formatNumber(n.data.days) : '';
  if (n.kind === 'task_overdue_escalation') {
    const assignee = typeof n.data.assignee === 'string' ? n.data.assignee : '';
    return assignee
      ? t('notifications.kinds.task_overdue_escalation', { title: n.title, assignee, days })
      : t('notifications.kinds.task_overdue_escalation_unassigned', { title: n.title, days });
  }
  return t(`notifications.kinds.${n.kind}`, { actor, title: n.title, date });
}

export function notificationHref(n: Notification): string {
  return n.subjectType === 'project' ? `/projects/${n.subjectId}` : `/tasks/${n.subjectId}`;
}
