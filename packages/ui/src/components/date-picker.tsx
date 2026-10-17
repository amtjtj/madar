'use client';

import { t } from '@madar/i18n';
import {
  addDays,
  formatCalendarDate,
  formatNumber,
  jalaliMonthGrid,
  jalaliOfCalendarDate,
  JALALI_MONTHS,
  PERSIAN_WEEKDAYS,
  persianWeekdayOfCalendarDate,
  shiftJalaliMonth,
} from '@madar/shared';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId, useState } from 'react';

import { cn } from '../lib/cn.js';

export interface DatePickerProps {
  /** Calendar date (YYYY-MM-DD) or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Today in the tenant time zone (YYYY-MM-DD); highlights it and powers the quick picks. */
  today: string;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Jalali date picker: Saturday-first weeks, Friday marked as the weekend, Persian digits,
 * quick picks for today / tomorrow / next Saturday. Works with keyboard and touch.
 */
export function DatePicker({
  value,
  onChange,
  today,
  label,
  hideLabel,
  placeholder = t('ui.datePicker.placeholder'),
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const start = jalaliOfCalendarDate(value ?? today);
  const [month, setMonth] = useState({ jy: start.jy, jm: start.jm });
  const labelId = useId();

  const pick = (date: string | null) => {
    onChange(date);
    setOpen(false);
  };
  const onOpenChange = (next: boolean) => {
    if (next) {
      const focus = jalaliOfCalendarDate(value ?? today);
      setMonth({ jy: focus.jy, jm: focus.jm });
    }
    setOpen(next);
  };

  const nextSaturday = addDays(today, 7 - persianWeekdayOfCalendarDate(today));
  const quickPicks = [
    { key: 'today', label: t('ui.datePicker.today'), date: today },
    { key: 'tomorrow', label: t('ui.datePicker.tomorrow'), date: addDays(today, 1) },
    { key: 'nextWeek', label: t('ui.datePicker.nextWeek'), date: nextSaturday },
  ];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span id={labelId} className={cn('text-sm font-medium text-ink', hideLabel && 'sr-only')}>
          {label}
        </span>
      )}
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-labelledby={label ? labelId : undefined}
            aria-label={label ? undefined : placeholder}
            className={cn(
              'flex h-12 w-full items-center gap-2 rounded-lg border-2 border-line bg-surface px-4 text-start text-base',
              'transition-colors duration-(--duration-fast) hover:border-line-strong',
              'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-soft',
              'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
              value ? 'text-ink' : 'text-ink-subtle',
            )}
          >
            <CalendarDays aria-hidden className="size-5 shrink-0 text-ink-subtle" />
            <span className="truncate">
              {value ? formatCalendarDate(value, 'full') : placeholder}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-fade-in"
            dir="rtl"
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {quickPicks.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => pick(q.date)}
                  className={cn(
                    'h-8 rounded-full px-3 text-sm font-semibold transition-colors',
                    value === q.date
                      ? 'bg-primary text-on-primary'
                      : 'bg-sunken text-ink hover:bg-primary-soft hover:text-primary-ink',
                  )}
                >
                  {q.label}
                </button>
              ))}
              {value && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="ms-auto inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-semibold text-ink-muted hover:bg-sunken [&_svg]:size-4"
                >
                  <X aria-hidden />
                  {t('ui.datePicker.clear')}
                </button>
              )}
            </div>
            <MonthGrid
              month={month}
              onMonthChange={setMonth}
              value={value}
              today={today}
              onPick={pick}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

interface MonthGridProps {
  month: { jy: number; jm: number };
  onMonthChange: (month: { jy: number; jm: number }) => void;
  value: string | null;
  today: string;
  onPick: (date: string) => void;
}

function MonthGrid({ month, onMonthChange, value, today, onPick }: MonthGridProps) {
  const weeks = jalaliMonthGrid(month.jy, month.jm);
  const title = `${JALALI_MONTHS[month.jm - 1]} ${formatNumber(month.jy, { useGrouping: false })}`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {/* RTL: the previous month is on the right (start). */}
        <button
          type="button"
          aria-label={t('ui.datePicker.previousMonth')}
          onClick={() => onMonthChange(shiftJalaliMonth(month.jy, month.jm, -1))}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-sunken [&_svg]:size-5"
        >
          <ChevronRight aria-hidden />
        </button>
        <span className="font-bold text-ink" aria-live="polite">
          {title}
        </span>
        <button
          type="button"
          aria-label={t('ui.datePicker.nextMonth')}
          onClick={() => onMonthChange(shiftJalaliMonth(month.jy, month.jm, 1))}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-sunken [&_svg]:size-5"
        >
          <ChevronLeft aria-hidden />
        </button>
      </div>
      <table
        className="w-full table-fixed border-collapse text-center"
        role="grid"
        aria-label={title}
      >
        <thead>
          <tr>
            {PERSIAN_WEEKDAYS.map((day, i) => (
              <th
                key={day}
                scope="col"
                abbr={day}
                className={cn(
                  'pb-1 text-xs font-semibold',
                  i === 6 ? 'text-danger-ink' : 'text-ink-subtle',
                )}
              >
                {day.slice(0, 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((date, i) => (
                <td key={date ?? `pad-${w}-${i}`} className="p-0.5">
                  {date && (
                    <button
                      type="button"
                      onClick={() => onPick(date)}
                      aria-pressed={date === value}
                      aria-current={date === today ? 'date' : undefined}
                      aria-label={`${formatCalendarDate(date, 'full')}${i === 6 ? ` (${t('ui.datePicker.holiday')})` : ''}`}
                      className={cn(
                        'grid aspect-square w-full place-items-center rounded-full text-sm font-medium transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                        date === value
                          ? 'bg-primary font-bold text-on-primary'
                          : date === today
                            ? 'bg-primary-soft font-bold text-primary-ink'
                            : i === 6
                              ? 'text-danger-ink hover:bg-sunken'
                              : 'text-ink hover:bg-sunken',
                      )}
                    >
                      {formatNumber(jalaliOfCalendarDate(date).jd)}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
