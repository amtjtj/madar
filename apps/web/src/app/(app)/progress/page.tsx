'use client';

import { t } from '@madar/i18n';
import { addDays, formatNumber, formatPercent, formatRelativeTime } from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  LevelBar,
  Skeleton,
  StreakFlame,
  StreakMap,
  XpRow,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useMyProgress, useStreakDays, useXpHistory } from '@/hooks/progress';

const MAP_DAYS = 12 * 7;

/** «پیشرفت من» (ADR 0029): my level, streak, the last twelve weeks and my XP history. */
export default function ProgressPage() {
  const { data: progress, isPending } = useMyProgress();
  return (
    <>
      <PageHeader title={t('progress.title')} subtitle={t('progress.subtitle')} />
      <div className="flex flex-col gap-4 pb-20 md:pb-0">
        {isPending || !progress ? (
          <>
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </>
        ) : !progress.enabled ? (
          <Card>
            <EmptyState title={t('progress.off')} />
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-col gap-4 pt-4">
                <LevelBar
                  level={progress.level}
                  into={progress.levelInto}
                  span={progress.levelSpan}
                />
                <p className="text-sm text-ink-muted">
                  {t('progress.totalXp', { xp: formatNumber(progress.xp) })}
                  {'، '}
                  {t('progress.todayXp', { xp: formatNumber(progress.today.xp) })}
                </p>
                {progress.today.capReached && (
                  <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">
                    {t('progress.capReached')}
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 rounded-xl bg-sunken p-3">
                    <dt className="text-sm text-ink-muted">{t('progress.streakNow')}</dt>
                    <dd>
                      <StreakFlame
                        size="lg"
                        count={progress.currentStreak}
                        lit={progress.today.complete}
                      />
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1 rounded-xl bg-sunken p-3">
                    <dt className="text-sm text-ink-muted">{t('progress.streakBest')}</dt>
                    <dd className="text-2xl font-extrabold text-ink tabular-nums">
                      {t('progress.days', { count: formatNumber(progress.longestStreak) })}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <StreakCard today={progress.today.date} percent={progress.completeDayPercent} />
            <HistoryCard />
          </>
        )}
      </div>
    </>
  );
}

function StreakCard({ today, percent }: { today: string; percent: number }) {
  const from = addDays(today, -(MAP_DAYS - 1));
  const to = addDays(today, -1);
  const { data: days } = useStreakDays(from, to);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <h2 className="font-bold text-ink">{t('progress.mapTitle')}</h2>
        {days ? (
          <StreakMap days={days} from={from} to={to} />
        ) : (
          <Skeleton className="h-36 rounded-lg" />
        )}
        <p className="text-sm text-ink-muted">
          {t('progress.mapHint', { percent: formatPercent(percent / 100) })}
        </p>
      </CardContent>
    </Card>
  );
}

function HistoryCard() {
  const history = useXpHistory();
  const entries = history.data?.pages.flat() ?? [];
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-4">
        <h2 className="font-bold text-ink">{t('progress.historyTitle')}</h2>
        {history.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : entries.length === 0 ? (
          <EmptyState title={t('progress.historyEmpty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id}>
                <XpRow
                  amount={e.amount}
                  reason={e.reason}
                  title={e.task?.title}
                  weight={e.task?.weight}
                  when={formatRelativeTime(new Date(e.createdAt))}
                />
              </li>
            ))}
          </ul>
        )}
        {history.hasNextPage && (
          <Button
            variant="ghost"
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('progress.more')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
