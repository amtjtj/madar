'use client';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { DatePicker } from './date-picker.js';
import { TextField } from './input.js';
import { Skeleton } from './skeleton.js';

/** «پیش‌نویس دستیار»: marks text the assistant wrote, for a person to read with care (ADR 0025). */
export function AssistantBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink [&_svg]:size-3.5',
        className,
      )}
    >
      <Sparkles aria-hidden />
      {t('ui.assistant.badge')}
    </span>
  );
}

/** While the model works: a calm placeholder (it can take a while on a CPU server). */
export function AssistantThinking({ lines = 3, action }: { lines?: number; action?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-muted [&_svg]:size-4">
        <Sparkles
          aria-hidden
          className="animate-pulse text-accent-ink motion-reduce:animate-none"
        />
        {t('ui.assistant.thinking')}
      </p>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-10 rounded-xl', i === lines - 1 && 'w-2/3')} />
      ))}
      {action}
    </div>
  );
}

export interface Suggestion {
  key: string;
  title: string;
  dueOn: string | null;
}

export interface SuggestionListProps {
  items: Suggestion[];
  onChange: (items: Suggestion[]) => void;
  /** Today in the company's time zone (for the date pickers). */
  today: string;
  /** Extra fields per row (e.g. the assignee), rendered under title and date. */
  extra?: (item: Suggestion) => ReactNode;
  /** Accessible name of the list. */
  label: string;
  newKey: () => string;
}

/** Suggestions a person edits before anything is made: titles, dates, rows removed or added. */
export function SuggestionList({
  items,
  onChange,
  today,
  extra,
  label,
  newKey,
}: SuggestionListProps) {
  const update = (key: string, changes: Partial<Suggestion>) =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label={label} className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li
            key={item.key}
            className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3"
          >
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-3 grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-bold text-ink-muted"
              >
                {formatNumber(index + 1)}
              </span>
              <TextField
                className="min-w-0 flex-1"
                label={t('ui.assistant.title')}
                hideLabel
                value={item.title}
                maxLength={200}
                onChange={(e) => update(item.key, { title: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  item.title.trim()
                    ? t('ui.assistant.remove', { title: item.title.trim() })
                    : t('ui.assistant.removeEmpty')
                }
                icon={<Trash2 aria-hidden />}
                onClick={() => onChange(items.filter((i) => i.key !== item.key))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DatePicker
                label={t('ui.assistant.due')}
                value={item.dueOn}
                onChange={(dueOn) => update(item.key, { dueOn })}
                today={today}
              />
              {extra?.(item)}
            </div>
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        icon={<Plus aria-hidden />}
        className="self-start"
        onClick={() => onChange([...items, { key: newKey(), title: '', dueOn: null }])}
      >
        {t('ui.assistant.add')}
      </Button>
    </div>
  );
}
