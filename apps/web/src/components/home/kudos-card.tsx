'use client';

import { HeartHandshake } from 'lucide-react';

import { t } from '@madar/i18n';
import { Card, CardContent } from '@madar/ui';

import { KudosList } from '@/components/kudos/kudos-list';
import { ThankDialog } from '@/components/kudos/thank-dialog';
import { useKudos } from '@/hooks/kudos';
import { useMyProgress } from '@/hooks/progress';

/**
 * «قدردانی‌های تازه» on the home page (ADR 0030): the company's latest public thanks, by time only
 * (never a count or a ranking), with «تشکر از یک همکار».
 */
export function RecentKudosCard() {
  const { data: progress } = useMyProgress();
  const { data } = useKudos(null, 3);
  const items = data?.pages[0] ?? [];
  if (!progress?.enabled) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold text-ink [&_svg]:size-5 [&_svg]:text-primary-ink">
            <HeartHandshake aria-hidden />
            {t('kudos.recentTitle')}
          </h2>
          <ThankDialog />
        </div>
        {items.length ? (
          <KudosList items={items} />
        ) : (
          <p className="text-sm text-ink-muted">{t('kudos.empty')}</p>
        )}
      </CardContent>
    </Card>
  );
}
