'use client';

import { EyeOff } from 'lucide-react';

import { t } from '@madar/i18n';
import { formatRelativeTime, type KudosItem } from '@madar/shared';
import { Button, KudosCard } from '@madar/ui';

/** Kudos as cards, newest first; the receiver may hide one from their profile. */
export function KudosList({
  items,
  onHide,
}: {
  items: KudosItem[];
  onHide?: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((k) => (
        <li key={k.id} className={k.hidden ? 'opacity-60' : undefined}>
          <KudosCard
            from={k.from.displayName}
            to={k.to.displayName}
            tag={k.valueTag}
            message={k.message}
            taskTitle={k.task?.title}
            when={k.hidden ? t('kudos.hidden') : formatRelativeTime(new Date(k.createdAt))}
            private={k.private}
            actions={
              onHide && !k.hidden ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('kudos.hide')}
                  title={t('kudos.hide')}
                  icon={<EyeOff aria-hidden />}
                  onClick={() => onHide(k.id)}
                />
              ) : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}
