'use client';

import { t } from '@madar/i18n';
import { EmptyState } from '@madar/ui';

/** Desktop only: nothing open yet (phones show the list instead). */
export default function ChatPage() {
  return (
    <div className="m-auto">
      <EmptyState title={t('chat.pick')} description={t('chat.pickHint')} />
    </div>
  );
}
