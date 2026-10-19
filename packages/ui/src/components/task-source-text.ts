import { t } from '@madar/i18n';
import type { RankReason, Task } from '@madar/shared';

/**
 * Words for a task's source and rank reasons (ADR 0017). A plain module so server components and
 * other text (detail lines, notifications) can use it too.
 */
export type TaskSourceInfo = NonNullable<Task['source']>;

export function sourceLabel(source: TaskSourceInfo, full = false): string {
  const name = source.by?.displayName;
  switch (source.kind) {
    case 'personal':
      return t('work.source.personal');
    case 'request':
      return name ? t('work.source.request', { name }) : t('work.source.someone');
    case 'meeting':
      return t('work.source.meeting');
    case 'assigned':
      if (source.ceo)
        return full && name ? t('work.source.ceoFull', { name }) : t('work.source.ceo');
      if (!name) return t('work.source.someone');
      if (!full) return t('work.source.assigned', { name });
      return source.by?.title
        ? t('work.source.assignedWithTitle', { name, title: source.by.title })
        : t('work.source.assignedFull', { name });
  }
}

/** «سررسید فردا و ابلاغ مدیرعامل», or a calm default when nothing stands out. */
export function rankText(reasons: readonly RankReason[]): string {
  const words = reasons.map((r) => t(`work.rank.reasons.${r}`));
  if (words.length === 0) return t('work.rank.none');
  if (words.length === 1) return words[0] ?? '';
  return t('work.rank.and', { first: words[0] ?? '', second: words[1] ?? '' });
}
