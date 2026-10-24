import type { DueStatus, StatusCategory, StatusColor, TaskPriority } from '@madar/shared';

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

/** Department status colours as token classes (plan phase-3-step-19a). */
export const statusColorTone: Record<StatusColor, string> = {
  gray: 'bg-sunken text-ink-muted',
  blue: 'bg-info-soft text-info-ink',
  violet: 'bg-violet-soft text-violet-ink',
  amber: 'bg-warning-soft text-warning-ink',
  orange: 'bg-streak-soft text-ink',
  green: 'bg-success-soft text-success-ink',
  teal: 'bg-primary-soft text-primary-ink',
  red: 'bg-danger-soft text-danger-ink',
};

export const statusColorDot: Record<StatusColor, string> = {
  gray: 'bg-ink-subtle',
  blue: 'bg-info',
  violet: 'bg-violet',
  amber: 'bg-warning',
  orange: 'bg-streak',
  green: 'bg-success',
  teal: 'bg-primary',
  red: 'bg-danger',
};
