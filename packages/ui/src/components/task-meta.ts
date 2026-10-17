import type { DueStatus, StatusCategory, TaskPriority } from '@madar/shared';

/** Badge tones for task priority and due status (plain module: shared by server and client). */
export const priorityTone: Record<TaskPriority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

export const dueTone: Record<DueStatus, 'danger' | 'warning' | 'info' | 'neutral'> = {
  overdue: 'danger',
  today: 'warning',
  tomorrow: 'info',
  upcoming: 'neutral',
};

/** Dot color per status category (board column headers). */
export const statusDot: Record<StatusCategory, string> = {
  todo: 'bg-line-strong',
  in_progress: 'bg-info',
  done: 'bg-primary',
  canceled: 'bg-ink-subtle',
};
