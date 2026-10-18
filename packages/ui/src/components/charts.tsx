'use client';

import { formatNumber } from '@madar/shared';
import { useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import type { LinkComponent } from './navigation.js';

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

/*
 * Small SVG-free charts built from boxes (ADR 0014): one axis, thin marks with rounded data ends,
 * colors only from tokens, Persian digits, a tooltip on hover and tap, and either labelled links or
 * a hidden table for screen readers. Text never wears the series color.
 */

type Tone = 'primary' | 'danger' | 'warning' | 'neutral';

const TONE_FILL: Record<Tone, string> = {
  primary: 'bg-chart-1',
  danger: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-line-strong',
};

const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-ink',
  danger: 'text-danger-ink',
  warning: 'text-warning-ink',
  neutral: 'text-ink',
};

export interface StatTileProps {
  label: string;
  /** Already formatted (Persian digits). */
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}

/** A headline number: the answer before any chart. */
export function StatTile({ label, value, hint, tone = 'neutral', icon, className }: StatTileProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-start gap-1.5 text-xs font-medium text-ink-muted sm:text-sm [&_svg]:mt-0.5 [&_svg]:hidden [&_svg]:size-4 sm:[&_svg]:block">
        {icon}
        {label}
      </span>
      <span className={cn('text-2xl font-black tabular-nums sm:text-3xl', TONE_TEXT[tone])}>
        {value}
      </span>
      {hint && <span className="hidden text-xs text-ink-subtle sm:block">{hint}</span>}
    </div>
  );
}

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** Extra text after the value, e.g. a status word. */
  note?: ReactNode;
  href?: string;
}

export interface BarListProps {
  /** Names the measure (shown to screen readers and as the table caption). */
  title: string;
  items: BarListItem[];
  tone?: Tone;
  format?: (value: number) => string;
  link?: LinkComponent;
  className?: string;
}

/** One measure per row: label, bar from the inline start, value. */
export function BarList({
  title,
  items,
  tone = 'primary',
  format = (v) => formatNumber(v),
  link: Link = DefaultLink,
  className,
}: BarListProps) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const linked = items.some((i) => i.href);
  return (
    <div className={className}>
      <ul
        className="flex flex-col gap-1"
        aria-label={title}
        aria-hidden={linked ? undefined : true}
      >
        {items.map((item) => {
          const row = (
            <>
              <span className="w-24 shrink-0 truncate text-sm text-ink sm:w-32">{item.label}</span>
              <span className="relative h-3 flex-1 rounded-full bg-sunken">
                {item.value > 0 && (
                  <span
                    className={cn('absolute inset-y-0 start-0 rounded-full', TONE_FILL[tone])}
                    style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }}
                  />
                )}
              </span>
              <span className="w-10 shrink-0 text-end text-sm font-semibold text-ink tabular-nums">
                {format(item.value)}
              </span>
              {item.note}
            </>
          );
          return (
            <li key={item.key}>
              {item.href ? (
                // The link carries the name and value; the drawing inside is decoration.
                <Link
                  href={item.href}
                  aria-label={`${item.label}: ${format(item.value)}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {row}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-2 py-1.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
      {!linked && <DataTable title={title} rows={items.map((i) => [i.label, format(i.value)])} />}
    </div>
  );
}

export interface StackedSeries {
  key: string;
  label: string;
  /** A chart token class, e.g. `bg-chart-1`. */
  fill: string;
}

export interface StackedBarListProps {
  title: string;
  series: StackedSeries[];
  rows: Array<{ key: string; label: string; values: number[]; note?: ReactNode }>;
  format?: (value: number) => string;
  className?: string;
}

/** Several parts per row (e.g. to do / in progress), with a legend; a 2px gap between parts. */
export function StackedBarList({
  title,
  series,
  rows,
  format = (v) => formatNumber(v),
  className,
}: StackedBarListProps) {
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-hidden>
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', s.fill)} />
            {s.label}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-1" aria-hidden>
        {rows.map((row) => {
          const total = row.values.reduce((a, b) => a + b, 0);
          return (
            <li
              key={row.key}
              className="relative flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-sunken"
              onMouseEnter={() => setActive(row.key)}
              onMouseLeave={() => setActive(null)}
              // Phones have no hover: a tap shows or hides the split.
              onClick={() => setActive((current) => (current === row.key ? null : row.key))}
            >
              <span className="w-24 shrink-0 truncate text-sm text-ink sm:w-32">{row.label}</span>
              <span className="flex h-3 flex-1 gap-0.5">
                {row.values.map((value, i) =>
                  value > 0 ? (
                    <span
                      key={series[i]?.key ?? i}
                      className={cn(
                        'h-full first:rounded-s-full last:rounded-e-full',
                        series[i]?.fill,
                      )}
                      style={{ width: `${(value / max) * 100}%` }}
                    />
                  ) : null,
                )}
              </span>
              <span className="w-10 shrink-0 text-end text-sm font-semibold text-ink tabular-nums">
                {format(total)}
              </span>
              {row.note}
              {active === row.key && total > 0 && (
                <span className="pointer-events-none absolute -top-8 start-24 z-10 rounded-md bg-ink px-2 py-1 text-xs text-surface shadow-md sm:start-32">
                  {series.map((s, i) => `${s.label}: ${format(row.values[i] ?? 0)}`).join('، ')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <DataTable
        title={title}
        header={['', ...series.map((s) => s.label)]}
        rows={rows.map((r) => [r.label, ...r.values.map(format)])}
      />
    </div>
  );
}

export interface ColumnChartProps {
  title: string;
  /** Oldest first; time runs left to right like any chart (ADR 0014). */
  points: Array<{ key: string; label: string; value: number }>;
  format?: (value: number) => string;
  className?: string;
}

/** Counts over time as columns, e.g. tasks done per week. The latest value is labelled. */
export function ColumnChart({
  title,
  points,
  format = (v) => formatNumber(v),
  className,
}: ColumnChartProps) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const [active, setActive] = useState<number | null>(null);
  const last = points.length - 1;
  return (
    <div className={className}>
      <div dir="ltr" className="flex h-32 items-end gap-1.5 border-b border-line" aria-hidden>
        {points.map((p, i) => (
          <div
            key={p.key}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            // Phones have no hover: a tap shows or hides the value. Keyboard and screen-reader
            // users get the same numbers from the table below.
            onClick={() => setActive((current) => (current === i ? null : i))}
            className="relative flex h-full flex-1 flex-col items-center justify-end"
          >
            {(active === i || (active === null && i === last)) && (
              <span
                dir="rtl"
                className={cn(
                  'mb-1 whitespace-nowrap text-xs font-semibold tabular-nums',
                  active === i ? 'rounded-md bg-ink px-1.5 py-0.5 text-surface' : 'text-ink',
                )}
              >
                {active === i ? `${p.label}: ${format(p.value)}` : format(p.value)}
              </span>
            )}
            <span
              className={cn(
                'w-full max-w-8 rounded-t-[4px] bg-chart-1 transition-opacity',
                active !== null && active !== i && 'opacity-60',
              )}
              style={{ height: `${p.value > 0 ? Math.max(4, (p.value / max) * 85) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div dir="ltr" className="mt-1 flex gap-1.5" aria-hidden>
        {points.map((p, i) => (
          <span
            key={p.key}
            className={cn(
              // Every other label on phones; the visible ones may overflow into the hidden ones.
              'flex flex-1 justify-center text-[0.65rem] whitespace-nowrap text-ink-subtle',
              i % 2 !== last % 2 && 'invisible sm:visible',
              // The newest label sits at the edge: keep it inside the card.
              i === last && 'justify-end',
            )}
          >
            {p.label}
          </span>
        ))}
      </div>
      <DataTable title={title} rows={points.map((p) => [p.label, format(p.value)])} />
    </div>
  );
}

/** The same numbers as a table, for screen readers (the visual chart is aria-hidden). */
function DataTable({
  title,
  header,
  rows,
}: {
  title: string;
  header?: string[];
  rows: string[][];
}) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      {header && (
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
