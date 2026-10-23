'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { t } from '@madar/i18n';
import { MEETING_RANGES, type MeetingRange } from '@madar/shared';
import { Button, EmptyState, MeetingRow, Skeleton, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useMeetings } from '@/hooks/meetings';
import { useMe } from '@/hooks/use-me';
import { groupUpcoming, isLive, meetingTime } from '@/lib/meetings';

/** «پیش رو» grouped by day, and «گذشته» newest first (plan phase-2-step-13a §6). */
export function MeetingList() {
  const params = useSearchParams();
  const router = useRouter();
  const range: MeetingRange = params.get('range') === 'past' ? 'past' : 'upcoming';
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useMeetings(range);
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const groups = range === 'upcoming' ? groupUpcoming(items, timeZone) : [{ group: null, items }];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t('meetings.rangesLabel')}>
        <ul className="grid w-full grid-cols-2 gap-1 rounded-lg bg-sunken p-1 sm:flex sm:w-max">
          {MEETING_RANGES.map((r) => (
            <li key={r}>
              <NextLink
                href={r === 'upcoming' ? '/meetings' : '/meetings?range=past'}
                aria-current={r === range ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors',
                  r === range ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t(`meetings.ranges.${r}`)}
              </NextLink>
            </li>
          ))}
        </ul>
      </nav>

      {isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t(`meetings.empty.${range}`)}
          description={t('meetings.emptyHint')}
          action={<Button onClick={() => router.push('/meetings/new')}>{t('meetings.new')}</Button>}
        />
      ) : (
        groups.map(({ group, items: rows }) => (
          <section key={group ?? 'all'} className="flex flex-col gap-2">
            {group && (
              <h2 className="text-sm font-bold text-ink-muted">{t(`meetings.groups.${group}`)}</h2>
            )}
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface p-1">
              {rows.map((m) => (
                <li key={m.id}>
                  <MeetingRow
                    href={`/meetings/${m.id}`}
                    Link={NextLink}
                    title={m.title}
                    type={m.type}
                    time={meetingTime(m, timeZone, group !== 'today')}
                    participantCount={m.participantCount}
                    hasMinutes={m.hasMinutes}
                    canceled={m.canceledAt !== null}
                    live={isLive(m)}
                    weekly={m.seriesId !== null}
                    declined={m.myResponse === 'declined'}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {hasNextPage && (
        <Button
          variant="ghost"
          className="self-center"
          loading={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {t('meetings.loadMore')}
        </Button>
      )}
    </div>
  );
}
