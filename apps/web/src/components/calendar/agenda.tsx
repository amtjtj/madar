'use client';

import { CalendarOff } from 'lucide-react';

import { t } from '@madar/i18n';
import type { CalendarLayer } from '@madar/shared';
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from '@madar/ui';

import { useAgenda } from '@/hooks/calendar';
import { dayHeading } from '@/lib/calendar';

import { DayItems } from './day-items';

/** «فهرست زمانی»: from today on, day by day, only days with something (and today). */
export function Agenda({
  today,
  layers,
  timeZone,
}: {
  today: string;
  layers: CalendarLayer[];
  timeZone?: string;
}) {
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useAgenda(
    today,
    layers,
  );
  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }
  const pages = data?.pages ?? [];
  const overdue = pages[0]?.overdue ?? [];
  const days = pages
    .flatMap((p) => p.days)
    .filter((d) => d.items.length > 0 || d.date === today || d.holiday);
  const anything = overdue.length > 0 || days.some((d) => d.items.length > 0);
  return (
    <div className="flex flex-col gap-4">
      {pages.some((p) => p.truncated.length > 0) && (
        <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning-ink">
          {t('calendar.truncated')}
        </p>
      )}
      {overdue.length > 0 && (
        <section aria-label={t('calendar.overdue')} className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-danger-ink">{t('calendar.overdue')}</h2>
          <Card>
            <CardContent className="p-1">
              <DayItems items={overdue} timeZone={timeZone} />
            </CardContent>
          </Card>
        </section>
      )}
      {!anything && <EmptyState title={t('calendar.empty')} />}
      {anything &&
        days.map((day) => (
          <section
            key={day.date}
            aria-label={dayHeading(day.date, today)}
            className="flex flex-col gap-2"
          >
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink-muted">
              {dayHeading(day.date, today)}
              {(day.holiday || day.off) && (
                <Badge tone="danger">
                  <CalendarOff aria-hidden />
                  {day.holiday ? t('calendar.holiday') : t('calendar.off')}
                </Badge>
              )}
            </h2>
            <Card>
              <CardContent className="p-1">
                {day.items.length ? (
                  <DayItems items={day.items} timeZone={timeZone} />
                ) : (
                  <p className="px-3 py-3 text-sm text-ink-subtle">
                    {day.date === today ? t('calendar.emptyToday') : t('calendar.emptyDay')}
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        ))}
      {hasNextPage && (
        <Button
          variant="ghost"
          className="self-center"
          loading={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {t('calendar.later')}
        </Button>
      )}
    </div>
  );
}
