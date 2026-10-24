'use client';

import { use } from 'react';

import { t } from '@madar/i18n';
import { Avatar, BadgeGrid, Card, CardContent, EmptyState, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { KudosList } from '@/components/kudos/kudos-list';
import { ThankDialog } from '@/components/kudos/thank-dialog';
import { useHideKudos, useKudos, useProfile } from '@/hooks/kudos';

/**
 * A colleague's profile (ADR 0030): who they are, the badges they earned and the public thanks
 * they received. Never XP, level or streak (ADR 0029).
 */
export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: profile, isPending, isError } = useProfile(id);
  const kudos = useKudos(id);
  const hide = useHideKudos(id);
  if (isError) return <EmptyState title={t('profile.notFound')} />;
  if (isPending || !profile) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  const items = kudos.data?.pages.flat() ?? [];
  return (
    <>
      <PageHeader
        title={profile.displayName}
        subtitle={profile.departments.map((d) => d.name).join(t('ui.listSeparator'))}
        action={
          profile.gamification && !profile.me ? (
            <ThankDialog to={{ id: profile.id, displayName: profile.displayName }} />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4 pb-20 md:pb-0">
        {profile.me && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Avatar name={profile.displayName} size="sm" />
            {t('profile.you')}
          </p>
        )}
        {profile.gamification && (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <h2 className="font-bold text-ink">{t('profile.badges')}</h2>
              {profile.badges.length ? (
                <BadgeGrid items={profile.badges.map((b) => ({ ...b, earned: true }))} />
              ) : (
                <p className="text-sm text-ink-muted">{t('profile.noBadges')}</p>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4">
            <h2 className="font-bold text-ink">
              {profile.me ? t('kudos.receivedMine') : t('kudos.received')}
            </h2>
            {kudos.isPending ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : items.length ? (
              <KudosList
                items={items}
                onHide={profile.me ? (kudosId) => hide.mutate(kudosId) : undefined}
              />
            ) : (
              <p className="py-2 text-sm text-ink-muted">{t('kudos.emptyProfile')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
