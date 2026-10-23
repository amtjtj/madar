import { t } from '@madar/i18n';
import { PERSIAN_WEEKDAYS, jalaliOfCalendarDate, toPersianDigits } from '@madar/shared';
import {
  CalendarCheck,
  CheckSquare,
  Flag,
  FolderKanban,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import type { LinkComponent } from './navigation.js';

/** What a calendar item is, for its colour and icon (ADR 0024). */
export type CalendarLayerKind = 'task' | 'plan' | 'meeting' | 'project' | 'period';

const layerIcon: Record<CalendarLayerKind, LucideIcon> = {
  task: CheckSquare,
  plan: CalendarCheck,
  meeting: Users,
  project: FolderKanban,
  period: Flag,
};
const layerDot: Record<CalendarLayerKind, string> = {
  task: 'bg-layer-task',
  plan: 'bg-layer-plan',
  meeting: 'bg-layer-meeting',
  project: 'bg-layer-project',
  period: 'bg-layer-period',
};
const layerChip: Record<CalendarLayerKind, string> = {
  task: 'bg-layer-task-soft text-ink',
  plan: 'bg-layer-plan-soft text-ink',
  meeting: 'bg-layer-meeting-soft text-ink',
  project: 'bg-layer-project-soft text-ink',
  period: 'bg-layer-period-soft text-ink',
};

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

export interface CalendarItemRowProps {
  layer: CalendarLayerKind;
  title: string;
  href: string;
  /** «۱۰:۰۰ تا ۱۱:۰۰» for a meeting; nothing for an all-day item. */
  time?: string;
  /** Short tags, already worded («گذشته»، «برنامه امروز»). */
  tags?: ReactNode;
  /** Canceled: struck through. */
  struck?: boolean;
  /** Not coming, or done: quieter. */
  faded?: boolean;
  Link?: LinkComponent;
  className?: string;
}

/** One item of a calendar day, coloured by its layer. */
export function CalendarItemRow({
  layer,
  title,
  href,
  time,
  tags,
  struck = false,
  faded = false,
  Link = DefaultLink,
  className,
}: CalendarItemRowProps) {
  const Icon = layerIcon[layer];
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus',
        faded && 'opacity-60',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4',
          layerChip[layer],
        )}
      >
        <Icon aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm font-medium',
            struck ? 'text-ink-subtle line-through' : 'text-ink',
          )}
        >
          {title}
        </span>
        {(time || tags) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            {time && <span>{time}</span>}
            {tags}
          </span>
        )}
      </span>
      <span className={cn('size-2 shrink-0 rounded-full', layerDot[layer])} aria-hidden />
    </Link>
  );
}

export interface CalendarMonthCell {
  date: string;
  /** Part of the month shown (not an edge week's neighbour). */
  inMonth: boolean;
  today: boolean;
  /** A holiday or a weekday off. */
  off: boolean;
  /** Short labels shown on wide screens; dots on narrow ones. */
  items: Array<{ layer: CalendarLayerKind; title: string }>;
}

export interface CalendarMonthProps {
  /** Whole weeks, Saturday first. */
  cells: CalendarMonthCell[];
  selected?: string | null;
  onSelect: (date: string) => void;
  /** Accessible name of a day, already worded («پنجشنبه ۱ آبان، ۳ مورد»). */
  dayLabel: (cell: CalendarMonthCell) => string;
  className?: string;
}

/** A Jalali month: seven columns from Saturday, labels per day, a day opens with a tap. */
export function CalendarMonth({
  cells,
  selected,
  onSelect,
  dayLabel,
  className,
}: CalendarMonthProps) {
  const weeks: CalendarMonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <table className={cn('w-full table-fixed border-collapse', className)} role="grid">
      <thead>
        <tr>
          {PERSIAN_WEEKDAYS.map((day, i) => (
            <th
              key={day}
              scope="col"
              abbr={day}
              className={cn(
                'pb-2 text-xs font-semibold',
                i === 6 ? 'text-danger-ink' : 'text-ink-subtle',
              )}
            >
              <span className="md:hidden">{day.slice(0, 1)}</span>
              <span className="hidden md:inline">{day}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]?.date}>
            {week.map((cell) => {
              const shown = cell.items.slice(0, 3);
              const more = cell.items.length - shown.length;
              return (
                <td key={cell.date} className="border border-line p-0 align-top">
                  <button
                    type="button"
                    onClick={() => onSelect(cell.date)}
                    aria-label={dayLabel(cell)}
                    aria-pressed={selected === cell.date}
                    className={cn(
                      'flex h-16 w-full flex-col items-stretch gap-1 p-1 text-start transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus md:h-28 md:p-1.5',
                      cell.off && 'bg-sunken/60',
                      !cell.inMonth && 'opacity-45',
                      selected === cell.date && 'bg-primary-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-6 place-items-center self-start rounded-full text-xs font-semibold',
                        cell.today
                          ? 'bg-primary text-on-primary'
                          : cell.off
                            ? 'text-danger-ink'
                            : 'text-ink',
                      )}
                    >
                      {toPersianDigits(String(jalaliOfCalendarDate(cell.date).jd))}
                    </span>
                    {/* Narrow: coloured dots. */}
                    <span className="flex flex-wrap gap-0.5 md:hidden" aria-hidden>
                      {cell.items.slice(0, 4).map((item, i) => (
                        <span
                          key={i}
                          className={cn('size-1.5 rounded-full', layerDot[item.layer])}
                        />
                      ))}
                    </span>
                    {/* Wide: short labels and «+n». */}
                    <span className="hidden min-w-0 flex-col gap-0.5 md:flex" aria-hidden>
                      {shown.map((item, i) => (
                        <span
                          key={i}
                          className={cn(
                            'truncate rounded px-1 text-[0.6875rem] leading-5',
                            layerChip[item.layer],
                          )}
                        >
                          {item.title}
                        </span>
                      ))}
                      {more > 0 && (
                        <span className="px-1 text-[0.6875rem] text-ink-muted">
                          {t('ui.calendar.more', { count: toPersianDigits(String(more)) })}
                        </span>
                      )}
                    </span>
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface LayerToggleProps {
  layer: CalendarLayerKind | 'holiday';
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** One calendar layer, on or off (a switch with the layer's colour). */
export function LayerToggle({ layer, label, checked, onChange }: LayerToggleProps) {
  return (
    <label className="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-sunken">
      <span
        className={cn(
          'size-3 shrink-0 rounded-full',
          layer === 'holiday' ? 'bg-danger' : layerDot[layer],
        )}
        aria-hidden
      />
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-6 w-10 shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-focus after:absolute after:top-0.5 after:start-0.5 after:size-5 after:rounded-full after:bg-surface after:shadow-xs after:transition-transform peer-checked:after:translate-x-[-1rem] ltr:peer-checked:after:translate-x-4"
      />
    </label>
  );
}
