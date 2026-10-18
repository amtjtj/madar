'use client';

import { X } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import {
  PERSIAN_WEEKDAYS,
  formatCalendarDate,
  formatNumber,
  toPersianDigits,
  type DayHours,
  type WorkCalendarDto,
} from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  CheckboxField,
  DatePicker,
  EmptyState,
  SelectField,
  Skeleton,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useCan } from '@/hooks/queries';
import { useSaveWorkCalendar, useWorkCalendar } from '@/hooks/notifications';
import { useTodayDate } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

const DEFAULT_DAY = { start: '09:00', end: '18:00' };

/** Half-hour steps from 06:00 to 23:30, shown with Persian digits. */
const TIME_OPTIONS = Array.from({ length: 36 }, (_, i) => {
  const minutes = 6 * 60 + i * 30;
  const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 ? '30' : '00'}`;
  return { value, label: toPersianDigits(value) };
});

/** The half-hour steps, plus a saved time outside them (so it never shows as empty). */
const timeOptions = (current: string) =>
  TIME_OPTIONS.some((o) => o.value === current)
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { value: current, label: toPersianDigits(current) }].sort((a, b) =>
        a.value.localeCompare(b.value),
      );

export default function WorkCalendarPage() {
  const can = useCan();
  const { data } = useWorkCalendar();
  return (
    <>
      <PageHeader title={t('workCalendar.title')} subtitle={t('workCalendar.subtitle')} />
      {!can('tenant.manage') ? (
        <Card>
          <EmptyState title={t('errors.forbidden')} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <CalendarForm initial={data} />
      )}
    </>
  );
}

function CalendarForm({ initial }: { initial: WorkCalendarDto }) {
  const [calendar, setCalendar] = useState(initial);
  const [holiday, setHoliday] = useState<string | null>(null);
  const today = useTodayDate();
  const save = useSaveWorkCalendar();
  const { toast } = useToast();
  const invalid = calendar.weeklyHours.some((d) => d && d.start >= d.end);

  const setDay = (index: number, day: DayHours) =>
    setCalendar((c) => ({
      ...c,
      weeklyHours: c.weeklyHours.map((d, i) => (i === index ? day : d)),
    }));

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(calendar, {
          onSuccess: () => toast({ tone: 'success', title: t('workCalendar.saved') }),
          onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
        });
      }}
    >
      <Card>
        <CardContent className="flex flex-col gap-1">
          <h2 className="mb-2 text-lg font-bold text-ink">{t('workCalendar.weekTitle')}</h2>
          <ul className="flex flex-col divide-y divide-line">
            {calendar.weeklyHours.map((day, i) => (
              <li
                key={PERSIAN_WEEKDAYS[i]}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
              >
                <span className="w-24 font-semibold text-ink">{PERSIAN_WEEKDAYS[i]}</span>
                <CheckboxField
                  label={t('workCalendar.workingDay')}
                  checked={day !== null}
                  onChange={(e) => setDay(i, e.target.checked ? DEFAULT_DAY : null)}
                />
                {day ? (
                  <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-80">
                    <SelectField
                      label={t('workCalendar.from')}
                      value={day.start}
                      onChange={(e) => setDay(i, { ...day, start: e.target.value })}
                      options={timeOptions(day.start)}
                    />
                    <SelectField
                      label={t('workCalendar.to')}
                      value={day.end}
                      onChange={(e) => setDay(i, { ...day, end: e.target.value })}
                      options={timeOptions(day.end)}
                      error={day.start >= day.end ? t('workCalendar.invalidHours') : undefined}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-ink-subtle">{t('workCalendar.dayOff')}</span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold text-ink">{t('workCalendar.holidaysTitle')}</h2>
            <p className="text-sm text-ink-muted">{t('workCalendar.holidaysHint')}</p>
          </div>
          {calendar.holidays.length === 0 ? (
            <p className="text-sm text-ink-subtle">{t('workCalendar.noHolidays')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {calendar.holidays.map((date) => (
                <li
                  key={date}
                  className="inline-flex items-center gap-1 rounded-full bg-sunken py-1 ps-3 pe-1 text-sm font-medium text-ink"
                >
                  {formatCalendarDate(date, 'long')}
                  <button
                    type="button"
                    aria-label={t('workCalendar.removeHoliday', {
                      date: formatCalendarDate(date, 'long'),
                    })}
                    onClick={() =>
                      setCalendar((c) => ({ ...c, holidays: c.holidays.filter((d) => d !== date) }))
                    }
                    className="grid size-6 place-items-center rounded-full text-ink-subtle hover:bg-surface hover:text-ink [&_svg]:size-3.5"
                  >
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <DatePicker
              className="min-w-56 flex-1"
              label={t('workCalendar.addHoliday')}
              value={holiday}
              onChange={setHoliday}
              today={today}
            />
            <Button
              variant="secondary"
              disabled={!holiday}
              onClick={() => {
                if (!holiday) return;
                setCalendar((c) => ({
                  ...c,
                  holidays: [...new Set([...c.holidays, holiday])].sort(),
                }));
                setHoliday(null);
              }}
            >
              {t('workCalendar.addHoliday')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-ink">{t('workCalendar.escalationTitle')}</h2>
          <SelectField
            label={t('workCalendar.escalationLabel')}
            value={String(calendar.overdueEscalationDays)}
            onChange={(e) =>
              setCalendar((c) => ({ ...c, overdueEscalationDays: Number(e.target.value) }))
            }
            options={[0, 1, 2, 3, 5, 7].map((days) => ({
              value: String(days),
              label:
                days === 0
                  ? t('workCalendar.escalationOff')
                  : t('workCalendar.escalationDays', { days: formatNumber(days) }),
            }))}
          />
        </CardContent>
      </Card>

      <Button type="submit" className="self-start" loading={save.isPending} disabled={invalid}>
        {t('workCalendar.save')}
      </Button>
    </form>
  );
}
