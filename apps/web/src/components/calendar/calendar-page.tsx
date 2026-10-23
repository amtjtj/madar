'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { t } from '@madar/i18n';
import { calendarDateIn, type CalendarLayer } from '@madar/shared';
import { Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { Segmented } from '@/components/work/task-views';
import { useMe } from '@/hooks/use-me';
import { loadLayers, saveLayers } from '@/lib/calendar';

import { Agenda } from './agenda';
import { LayersDialog } from './layers-dialog';
import { MonthView } from './month-view';

type View = 'agenda' | 'month';

/** «تقویم» (plan phase-2-step-14a): phones open on the agenda, wide screens on the month. */
export function CalendarPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const requested = params.get('view');
  const [fallback, setFallback] = useState<View | null>(null);
  const [layers, setLayers] = useState<CalendarLayer[] | null>(null);
  // Chosen after mounting: the server cannot know the screen width or this device's layers.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFallback(window.matchMedia('(min-width: 768px)').matches ? 'month' : 'agenda');
    setLayers(loadLayers());
  }, []);
  const view: View | null = requested === 'agenda' || requested === 'month' ? requested : fallback;
  const today = calendarDateIn(new Date(), timeZone);

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        action={
          layers && (
            <LayersDialog
              layers={layers}
              onChange={(next) => {
                setLayers(next);
                saveLayers(next);
              }}
            />
          )
        }
      />
      <div className="flex flex-col gap-4 pb-20 md:pb-0">
        {view && (
          <div className="self-start">
            <Segmented
              label={t('calendar.viewsLabel')}
              value={view}
              onChange={(next) => router.replace(`/calendar?view=${next}`, { scroll: false })}
              options={[
                { value: 'agenda', label: t('calendar.views.agenda') },
                { value: 'month', label: t('calendar.views.month') },
              ]}
            />
          </div>
        )}
        {!view || !layers || !me ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : view === 'agenda' ? (
          <Agenda today={today} layers={layers} timeZone={timeZone} />
        ) : (
          <MonthView today={today} layers={layers} timeZone={timeZone} />
        )}
      </div>
    </>
  );
}
