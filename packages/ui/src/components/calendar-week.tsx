'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { t } from '@madar/i18n';
import {
  PERSIAN_WEEKDAYS,
  jalaliOfCalendarDate,
  persianWeekdayOfCalendarDate,
  toPersianDigits,
} from '@madar/shared';
import { GripVertical } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import type { CalendarLayerKind } from './calendar.js';
import type { LinkComponent } from './navigation.js';

/* ---------- Moving items between days (plan phase-2-step-14b) ---------- */

const DayDragContext = createContext(false);

// Pointer first; the keyboard (and a pointer outside every day) falls back to overlap.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** Arrow keys jump to the nearest day in that direction (in RTL the earlier day is to the east). */
const dayKeyboard: KeyboardCoordinateGetter = (event, { context }) => {
  // Screen directions as vectors: arrows move on the screen, whatever the reading direction.
  const step = (
    {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    } as Record<string, [number, number]>
  )[event.code];
  const rect = context.collisionRect;
  if (!step || !rect) return undefined;
  event.preventDefault();
  const [sx, sy] = step;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best: { x: number; y: number } | undefined;
  let bestDistance = Infinity;
  for (const container of context.droppableContainers.getEnabled()) {
    const target = context.droppableRects.get(container.id);
    if (!target) continue;
    const dx = target.left + target.width / 2 - cx;
    const dy = target.top + target.height / 2 - cy;
    const ahead = dx * sx + dy * sy > 1;
    if (!ahead) continue;
    const horizontal = sx !== 0;
    const distance = horizontal ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 3;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        x: target.left + target.width / 2 - rect.width / 2,
        y: target.top + target.height / 2 - rect.height / 2,
      };
    }
  }
  return best;
};

export interface CalendarDndProps {
  /** A dropped item and the day it landed on. */
  onMove: (itemId: string, date: string) => void;
  /** Names for the screen-reader announcements. */
  itemTitle: (itemId: string) => string;
  dayLabel: (date: string) => string;
  children: ReactNode;
}

/**
 * Lets `DragItem`s be dropped on `DropDay`s: mouse, touch (hold briefly, so scrolling still works)
 * and keyboard (Space on the handle, arrows between days, Space to drop), announced in Persian.
 */
export function CalendarDnd({ onMove, itemTitle, dayLabel, children }: CalendarDndProps) {
  const [active, setActive] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: dayKeyboard }),
  );
  const title = (id: UniqueIdentifier) => itemTitle(String(id));
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => t('ui.calendar.drag.picked', { title: title(a.id) }),
    onDragOver: ({ over }) =>
      over ? t('ui.calendar.drag.over', { day: dayLabel(String(over.id)) }) : undefined,
    onDragEnd: ({ active: a, over }) =>
      over
        ? t('ui.calendar.drag.dropped', { title: title(a.id), day: dayLabel(String(over.id)) })
        : t('ui.calendar.drag.outside', { title: title(a.id) }),
    onDragCancel: ({ active: a }) => t('ui.calendar.drag.canceled', { title: title(a.id) }),
  };
  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    if (over) onMove(String(a.id), String(over.id));
  };
  return (
    <DayDragContext.Provider value>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements }}
        onDragStart={({ active: a }: DragStartEvent) => setActive(String(a.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {active ? (
            <span className="inline-flex max-w-60 items-center gap-2 truncate rounded-xl bg-layer-task-soft px-3 py-2 text-sm font-medium text-ink shadow-lg">
              {itemTitle(active)}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DayDragContext.Provider>
  );
}

/** A day items can be dropped on; outside `CalendarDnd` it renders its children as they are. */
export function DropDay({
  date,
  children,
  className,
}: {
  date: string;
  children: ReactNode;
  className?: string;
}) {
  const enabled = useContext(DayDragContext);
  if (!enabled)
    return (
      <div data-day={date} className={className}>
        {children}
      </div>
    );
  return (
    <DroppableDay date={date} className={className}>
      {children}
    </DroppableDay>
  );
}

function DroppableDay({
  date,
  children,
  className,
}: {
  date: string;
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div
      ref={setNodeRef}
      data-day={date}
      data-over={isOver || undefined}
      className={cn(
        'transition-colors data-[over]:bg-primary-soft data-[over]:outline-2 data-[over]:-outline-offset-2 data-[over]:outline-primary',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** An item that can be moved to another day; `children` gets the drag handle to place. */
export function DragItem({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const enabled = useContext(DayDragContext);
  if (!enabled) return <>{children(null)}</>;
  return (
    <DraggableItem id={id} title={title}>
      {children}
    </DraggableItem>
  );
}

function DraggableItem({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id,
  });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t('ui.calendar.drag.handle', { title })}
      className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-subtle hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing [&_svg]:size-4"
    >
      <GripVertical aria-hidden />
    </button>
  );
  return (
    <div ref={setNodeRef} className={cn(isDragging && 'opacity-40')}>
      {children(handle)}
    </div>
  );
}

/* ---------- Week and day grids ---------- */

/** Height of one hour in the time grid. */
const HOUR_PX = 48;

export interface WeekGridDay {
  date: string;
  today: boolean;
  /** A holiday or a weekday off. */
  off: boolean;
}

export interface WeekGridEvent {
  id: string;
  date: string;
  /** Minutes from local midnight. */
  start: number;
  end: number;
  /** Column placement among overlapping events (`layoutOverlaps`). */
  column: number;
  columns: number;
  node: ReactNode;
}

export interface WeekGridProps {
  /** One day (day view) or seven (week view, Saturday first). */
  days: WeekGridDay[];
  /** Whole hours to show (`timeGridSpan`). */
  startHour: number;
  endHour: number;
  /** The all-day items of a day (wrap them in `DropDay` to accept drops); no row without it. */
  allDay?: (day: WeekGridDay) => ReactNode;
  events: WeekGridEvent[];
  /** Minutes from midnight now, for the «اکنون» line on today. */
  nowMinutes?: number;
  /** Accessible name of a day's column header, already worded. */
  dayLabel: (day: WeekGridDay) => string;
  className?: string;
}

/** Days side by side: a header, an all-day row and an hour grid with timed events. */
export function WeekGrid({
  days,
  startHour,
  endHour,
  allDay,
  events,
  nowMinutes,
  dayLabel,
  className,
}: WeekGridProps) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const columns = { gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` };
  const top = (minutes: number) => ((minutes - startHour * 60) / 60) * HOUR_PX;
  const height = hours.length * HOUR_PX;
  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header (a single day is named by the page around it) */}
      <div
        className={cn('grid border-b border-line', days.length === 1 && 'sr-only')}
        style={columns}
      >
        <span aria-hidden />
        {days.map((day) => {
          const weekday = PERSIAN_WEEKDAYS[persianWeekdayOfCalendarDate(day.date)] ?? '';
          return (
            <div
              key={day.date}
              aria-label={dayLabel(day)}
              className="flex flex-col items-center gap-0.5 py-2 text-xs"
            >
              <span
                className={cn('font-semibold', day.off ? 'text-danger-ink' : 'text-ink-subtle')}
              >
                {days.length > 1 ? (
                  <>
                    <span className="lg:hidden">{weekday.slice(0, 1)}</span>
                    <span className="hidden lg:inline">{weekday}</span>
                  </>
                ) : (
                  weekday
                )}
              </span>
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full text-sm font-bold',
                  day.today
                    ? 'bg-primary text-on-primary'
                    : day.off
                      ? 'text-danger-ink'
                      : 'text-ink',
                )}
              >
                {toPersianDigits(String(jalaliOfCalendarDate(day.date).jd))}
              </span>
            </div>
          );
        })}
      </div>
      {/* All-day row */}
      {allDay && (
        <div className="grid border-b border-line" style={columns}>
          <span className="self-center px-1 text-center text-[0.6875rem] text-ink-subtle">
            {t('ui.calendar.allDay')}
          </span>
          {days.map((day) => (
            <div
              key={day.date}
              className={cn('min-h-12 min-w-0 border-s border-line', day.off && 'bg-sunken/60')}
            >
              {allDay(day)}
            </div>
          ))}
        </div>
      )}
      {/* Hours */}
      <div className="grid" style={columns} role="group" aria-label={t('ui.calendar.hours')}>
        <div className="relative" style={{ height }} aria-hidden>
          {hours.map((h) => (
            <span
              key={h}
              className="absolute inset-x-0 -translate-y-1/2 px-1 text-center text-[0.6875rem] text-ink-subtle"
              style={{ top: top(h * 60) }}
            >
              {h === startHour ? '' : toPersianDigits(`${h}:00`)}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day.date}
            className={cn('relative min-w-0 border-s border-line', day.off && 'bg-sunken/60')}
            style={{ height }}
          >
            {hours.map((h) => (
              <span
                key={h}
                aria-hidden
                className="absolute inset-x-0 border-t border-line/70"
                style={{ top: top(h * 60) }}
              />
            ))}
            <ul className="contents">
              {events
                .filter((e) => e.date === day.date)
                .map((e) => (
                  <li
                    key={e.id}
                    className="absolute px-0.5"
                    style={{
                      top: top(Math.max(e.start, startHour * 60)),
                      height: Math.max(
                        22,
                        top(Math.min(e.end, endHour * 60)) - top(Math.max(e.start, startHour * 60)),
                      ),
                      insetInlineStart: `${(e.column / e.columns) * 100}%`,
                      width: `${100 / e.columns}%`,
                    }}
                  >
                    {e.node}
                  </li>
                ))}
            </ul>
            {day.today &&
              nowMinutes !== undefined &&
              nowMinutes >= startHour * 60 &&
              nowMinutes <= endHour * 60 && (
                <span
                  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger"
                  style={{ top: top(nowMinutes) }}
                >
                  <span className="sr-only">{t('ui.calendar.now')}</span>
                  <span
                    aria-hidden
                    className="absolute -top-1 -start-1 size-2.5 rounded-full bg-danger"
                  />
                </span>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

const eventChip: Record<CalendarLayerKind, string> = {
  task: 'bg-layer-task-soft border-layer-task',
  plan: 'bg-layer-plan-soft border-layer-plan',
  meeting: 'bg-layer-meeting-soft border-layer-meeting',
  project: 'bg-layer-project-soft border-layer-project',
  period: 'bg-layer-period-soft border-layer-period',
};

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

export interface TimedEventProps {
  title: string;
  /** «۱۰:۰۰ تا ۱۱:۰۰». */
  time: string;
  href: string;
  layer?: CalendarLayerKind;
  struck?: boolean;
  faded?: boolean;
  Link?: LinkComponent;
}

/** A meeting in the hour grid: its layer colour, title and time, fitting the height it is given. */
export function TimedEvent({
  title,
  time,
  href,
  layer = 'meeting',
  struck = false,
  faded = false,
  Link = DefaultLink,
}: TimedEventProps) {
  return (
    <Link
      href={href}
      className={cn(
        // Wrapping row: a short meeting keeps its title on the one line it has room for.
        'flex h-full flex-wrap content-start gap-x-1.5 overflow-hidden rounded-lg border-s-4 px-1.5 py-0.5 text-[0.6875rem] leading-[1.125rem] text-ink transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus',
        eventChip[layer],
        faded && 'opacity-60',
      )}
    >
      <span
        className={cn(
          'max-w-full truncate font-semibold',
          struck && 'text-ink-subtle line-through',
        )}
      >
        {title}
      </span>
      <span className="max-w-full truncate text-ink-muted">{time}</span>
    </Link>
  );
}

export interface DayStripDay {
  date: string;
  today: boolean;
  off: boolean;
  /** Something is on that day (a dot). */
  busy: boolean;
}

/** Seven days to pick from (Saturday first); each day is also a drop target inside `CalendarDnd`. */
export function DayStrip({
  days,
  selected,
  onSelect,
  dayLabel,
  label,
  className,
}: {
  days: DayStripDay[];
  selected: string;
  onSelect: (date: string) => void;
  dayLabel: (day: DayStripDay) => string;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('grid grid-cols-7 gap-1', className)}>
      {days.map((day) => {
        const weekday = PERSIAN_WEEKDAYS[persianWeekdayOfCalendarDate(day.date)] ?? '';
        return (
          <DropDay key={day.date} date={day.date} className="rounded-xl">
            <button
              type="button"
              onClick={() => onSelect(day.date)}
              aria-pressed={selected === day.date}
              aria-current={day.today ? 'date' : undefined}
              aria-label={dayLabel(day)}
              className={cn(
                'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl text-xs transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus',
                selected === day.date && 'bg-primary-soft',
              )}
            >
              <span
                className={cn('font-semibold', day.off ? 'text-danger-ink' : 'text-ink-subtle')}
              >
                {weekday.slice(0, 1)}
              </span>
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full text-sm font-bold',
                  day.today
                    ? 'bg-primary text-on-primary'
                    : day.off
                      ? 'text-danger-ink'
                      : 'text-ink',
                )}
              >
                {toPersianDigits(String(jalaliOfCalendarDate(day.date).jd))}
              </span>
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', day.busy ? 'bg-primary' : 'bg-transparent')}
              />
            </button>
          </DropDay>
        );
      })}
    </div>
  );
}
