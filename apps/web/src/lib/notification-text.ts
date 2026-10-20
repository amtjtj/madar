import { t } from '@madar/i18n';
import { formatCalendarDate, formatNumber, type Notification } from '@madar/shared';

/** The Persian sentence for a notification (all text from i18n). */
export function notificationText(n: Notification): string {
  const actor = n.actor?.displayName ?? t('notifications.someone');
  const day = typeof n.data.dueOn === 'string' ? n.data.dueOn : n.data.week;
  const date = typeof day === 'string' ? formatCalendarDate(day) : '';
  const days = typeof n.data.days === 'number' ? formatNumber(n.data.days) : '';
  if (n.kind === 'task_overdue_escalation') {
    const assignee = typeof n.data.assignee === 'string' ? n.data.assignee : '';
    return assignee
      ? t('notifications.kinds.task_overdue_escalation', { title: n.title, assignee, days })
      : t('notifications.kinds.task_overdue_escalation_unassigned', { title: n.title, days });
  }
  if (n.kind === 'project_member_added' && n.data.role === 'observer') {
    return t('notifications.kinds.project_observer_added', { actor, title: n.title });
  }
  if (n.kind === 'chat_message' && n.data.direct) {
    return t('notifications.kinds.chat_message_direct', { actor });
  }
  if ((n.kind === 'letter_received' || n.kind === 'letter_referred') && n.data.confidential) {
    return t(`notifications.kinds.${n.kind}_confidential`, { actor });
  }
  return t(`notifications.kinds.${n.kind}`, { actor, title: n.title, date });
}

export function notificationHref(n: Notification): string {
  if (n.subjectType === 'letter') return `/letters/${n.subjectId}`;
  if (n.subjectType === 'conversation') return `/chat/${n.subjectId}`;
  if (n.subjectType === 'goal') return `/goals/${n.subjectId}`;
  if (n.subjectType === 'report') {
    const params = new URLSearchParams({ scope: String(n.data.scope ?? 'company') });
    if (typeof n.data.departmentId === 'string') params.set('departmentId', n.data.departmentId);
    if (typeof n.data.week === 'string') params.set('week', n.data.week);
    return `/reports?${params.toString()}`;
  }
  return n.subjectType === 'project' ? `/projects/${n.subjectId}` : `/tasks/${n.subjectId}`;
}
