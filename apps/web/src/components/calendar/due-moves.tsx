'use client';

import { CalendarClock } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { t } from '@madar/i18n';
import { formatCalendarDate, type CalendarDay, type CalendarItem } from '@madar/shared';
import { Button, CalendarDnd, DatePicker, Modal, useToast } from '@madar/ui';

import { useMoveDue } from '@/hooks/calendar';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { itemTitle } from '@/lib/calendar';

interface DueMoves {
  /** Opens «تغییر سررسید» for a movable task. */
  pick: (item: CalendarItem) => void;
}

const DueMovesContext = createContext<DueMoves | null>(null);

/** «تغییر سررسید» for a movable task; nothing outside `DueMovesProvider`. */
export function ChangeDueButton({
  item,
  compact = false,
}: {
  item: CalendarItem;
  compact?: boolean;
}) {
  const moves = useContext(DueMovesContext);
  if (!moves) return null;
  const label = t('calendar.changeDueOf', { title: itemTitle(item) });
  return compact ? (
    <button
      type="button"
      aria-label={label}
      onClick={() => moves.pick(item)}
      className="grid size-6 shrink-0 place-items-center rounded-md text-ink-subtle hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-3.5"
    >
      <CalendarClock aria-hidden />
    </button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      icon={<CalendarClock aria-hidden />}
      onClick={() => moves.pick(item)}
    />
  );
}

/** «تغییر سررسید» for a row, when it sits inside `DueMovesProvider`. */
export function useDueMoves(): DueMoves | null {
  return useContext(DueMovesContext);
}

/**
 * Moving due dates on the calendar (plan phase-2-step-14b): drops from `DragItem`s (with `drag`),
 * «تغییر سررسید», a confirmation before a day off, and a toast with «برگرداندن».
 * `items` maps each drag key (`dragKey`) to its item; `days` tells which days are off.
 */
export function DueMovesProvider({
  items,
  days,
  today,
  drag = true,
  children,
}: {
  items: Map<string, CalendarItem>;
  days: CalendarDay[];
  today: string;
  drag?: boolean;
  children: ReactNode;
}) {
  const move = useMoveDue(today);
  const { toast } = useToast();
  const [picking, setPicking] = useState<CalendarItem | null>(null);
  const [confirming, setConfirming] = useState<{ item: CalendarItem; date: string } | null>(null);

  const failed = (error: unknown) =>
    toast({
      title:
        error instanceof ApiClientError && error.code === 'version_conflict'
          ? t('calendar.moveConflict')
          : errorMessage(error),
      tone: 'error',
    });
  const save = (item: CalendarItem, date: string) => {
    const task = item.task;
    if (!task || task.dueOn === date) return;
    const from = task.dueOn;
    move.mutate(
      { id: item.id, version: task.version, dueOn: date },
      {
        onSuccess: (saved) =>
          toast({
            title: t('calendar.moved', {
              title: itemTitle(item),
              date: formatCalendarDate(date, 'full'),
            }),
            tone: 'success',
            action: from
              ? {
                  label: t('calendar.undo'),
                  onClick: () => move.mutate({ id: item.id, version: saved.version, dueOn: from }),
                }
              : undefined,
          }),
        onError: failed,
      },
    );
  };
  // A day off asks first; the date itself is never refused (a past one is allowed, as on the task page).
  const request = (item: CalendarItem, date: string) => {
    const day = days.find((d) => d.date === date);
    if (day && (day.off || day.holiday)) setConfirming({ item, date });
    else save(item, date);
  };

  const content = (
    <DueMovesContext.Provider value={{ pick: setPicking }}>
      {children}
      <Modal
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        title={picking ? t('calendar.changeDueOf', { title: itemTitle(picking) }) : ''}
      >
        {picking && (
          <DatePicker
            label={t('calendar.newDue')}
            value={picking.task?.dueOn ?? null}
            today={today}
            onChange={(date) => {
              const item = picking;
              setPicking(null);
              if (date) request(item, date);
            }}
          />
        )}
      </Modal>
      <Modal
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('calendar.offDayTitle')}
        description={
          confirming
            ? t('calendar.offDayBody', {
                title: itemTitle(confirming.item),
                date: formatCalendarDate(confirming.date, 'full'),
              })
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              {t('calendar.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (confirming) save(confirming.item, confirming.date);
                setConfirming(null);
              }}
            >
              {t('calendar.offDayConfirm')}
            </Button>
          </>
        }
      />
    </DueMovesContext.Provider>
  );
  if (!drag) return content;
  return (
    <CalendarDnd
      onMove={(key, date) => {
        const item = items.get(key);
        if (item) request(item, date);
      }}
      itemTitle={(key) => {
        const item = items.get(key);
        return item ? itemTitle(item) : '';
      }}
      dayLabel={(date) => formatCalendarDate(date, 'full')}
    >
      {content}
    </CalendarDnd>
  );
}
