import { Target } from 'lucide-react';

import { t } from '@madar/i18n';
import type { KeyResultRef } from '@madar/shared';
import { Badge } from '@madar/ui';

/** Small «which goal this serves» label for task cards. */
export function GoalTag({ keyResult }: { keyResult: KeyResultRef }) {
  if (!keyResult) return null;
  return (
    <Badge
      tone="primary"
      className="max-w-48"
      title={t('goals.link.goal', { title: keyResult.goal.title })}
    >
      <Target aria-hidden />
      <span className="truncate">{keyResult.goal.title}</span>
    </Badge>
  );
}
