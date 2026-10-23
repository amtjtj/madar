'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { t } from '@madar/i18n';
import { calendarDateIn, type CalendarLayer } from '@madar/shared';
import { SelectField, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { Segmented } from '@/components/work/task-views';
import { useCalendarPeople } from '@/hooks/calendar';
import { useMe } from '@/hooks/use-me';
import { loadLayers, saveLayers } from '@/lib/calendar';

import { Agenda } from './agenda';
import { DayView } from './day-view';
import { LayersDialog } from './layers-dialog';
import { MonthView } from './month-view';
import { WeekView } from './week-view';

type View = 'agenda' | 'day' | 'week' | 'month';
const WIDE_VIEWS: View[] = ['week', 'day', 'month', 'agenda'];
const NARROW_VIEWS: View[] = ['agenda', 'day', 'month'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «تقویم» (plans phase-2-step-14a and 14b): phones open on the agenda, wide screens on the week.
 * The view, the day and whose calendar it is live in the address (`?view=&date=&member=`).
 */
export function CalendarPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: people } = useCalendarPeople();
  const timeZone = me?.tenant?.timezone;
  const [wide, setWide] = useState<boolean | null>(null);
  const [layers, setLayers] = useState<CalendarLayer[] | null>(null);
  // Chosen after mounting: the server cannot know the screen width or this device's layers.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWide(query.matches);
    setLayers(loadLayers());
    const changed = () => setWide(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);

  const today = calendarDateIn(new Date(), timeZone);
  const views = wide ? WIDE_VIEWS : NARROW_VIEWS;
  const requested = params.get('view') as View | null;
  const view: View | null =
    wide === null
      ? null
      : requested === 'week' && !wide
        ? 'day'
        : requested && views.includes(requested)
          ? requested
          : (views[0] ?? 'agenda');
  const date = params.get('date');
  const anchor = date && DATE.test(date) ? date : today;
  const memberParam = params.get('member') ?? undefined;
  const member = memberParam && memberParam !== me?.member?.id ? memberParam : undefined;
  const person = member ? people?.find((p) => p.id === member) : undefined;

  const go = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/calendar?${next.toString()}`, { scroll: false });
  };
  const onAnchor = (next: string) => go({ date: next === today ? undefined : next });
  // Someone outside my list (an old link, a person who left): back to my own calendar.
  const unknown = member !== undefined && people !== undefined && !person;
  useEffect(() => {
    if (!unknown) return;
    const next = new URLSearchParams(window.location.search);
    next.delete('member');
    router.replace(`/calendar?${next.toString()}`, { scroll: false });
  }, [unknown, router]);

  return (
    <>
      <PageHeader
        title={person ? t('calendar.titleOf', { name: person.displayName }) : t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        action={
          layers && (
            <LayersDialog
              layers={layers}
              others={member !== undefined}
              onChange={(next) => {
                setLayers(next);
                saveLayers(next);
              }}
            />
          )
        }
      />
      <div className="flex flex-col gap-4 pb-20 md:pb-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {view && (
            <Segmented
              label={t('calendar.viewsLabel')}
              value={view}
              onChange={(next) => go({ view: next })}
              options={views.map((v) => ({ value: v, label: t(`calendar.views.${v}`) }))}
            />
          )}
          {people && people.length > 1 && (
            <SelectField
              className="sm:w-72"
              label={t('calendar.whose')}
              value={member ?? me?.member?.id ?? ''}
              onChange={(e) =>
                go({ member: e.target.value === me?.member?.id ? undefined : e.target.value })
              }
              options={people.map((p) => ({
                value: p.id,
                label:
                  p.id === me?.member?.id
                    ? t('calendar.me', { name: p.displayName })
                    : p.department
                      ? t('calendar.personOption', {
                          name: p.displayName,
                          department: p.department,
                        })
                      : p.displayName,
              }))}
            />
          )}
        </div>
        {!view || !layers || !me ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : view === 'agenda' ? (
          <Agenda
            key={member ?? 'me'}
            today={today}
            layers={layers}
            member={member}
            timeZone={timeZone}
          />
        ) : view === 'week' ? (
          <WeekView
            key={member ?? 'me'}
            anchor={anchor}
            today={today}
            layers={layers}
            member={member}
            timeZone={timeZone}
            onAnchor={onAnchor}
            onOpenDay={(day) => go({ view: 'day', date: day === today ? undefined : day })}
          />
        ) : view === 'day' ? (
          <DayView
            key={member ?? 'me'}
            anchor={anchor}
            today={today}
            layers={layers}
            member={member}
            timeZone={timeZone}
            onAnchor={onAnchor}
          />
        ) : (
          <MonthView
            key={member ?? 'me'}
            anchor={anchor}
            today={today}
            layers={layers}
            member={member}
            timeZone={timeZone}
            onAnchor={onAnchor}
          />
        )}
      </div>
    </>
  );
}
