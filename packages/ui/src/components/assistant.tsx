'use client';

import { t } from '@madar/i18n';
import { formatNumber, type KnowledgeKind } from '@madar/shared';
import { CalendarClock, ListTodo, Mail, MessageCircle, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { DatePicker } from './date-picker.js';
import { TextField } from './input.js';
import type { LinkComponent } from './navigation.js';
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
  /** Extra fields per row (e.g. the assignee), rendered under title and date; `n` is its number. */
  extra?: (item: Suggestion, n: string) => ReactNode;
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
                label={t('ui.assistant.title', { n: formatNumber(index + 1) })}
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
                label={t('ui.assistant.due', { n: formatNumber(index + 1) })}
                value={item.dueOn}
                onChange={(dueOn) => update(item.key, { dueOn })}
                today={today}
              />
              {extra?.(item, formatNumber(index + 1))}
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

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

const CITATION = /\[(\d{1,2})\]/g;

/** Text with `[n]` citations as links to the numbered sources below (ADR 0026). */
function CitedText({ text, idPrefix }: { text: string; idPrefix: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    const n = Number(match[1]);
    parts.push(
      <a
        key={`${at}-${n}`}
        href={`#${idPrefix}-${n}`}
        aria-label={t('ui.assistant.citation', { n: formatNumber(n) })}
        className="mx-0.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-accent-soft px-1 align-text-top text-xs font-bold text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {formatNumber(n)}
      </a>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export interface AnswerCardProps {
  /** The assistant's answer; `[n]` marks cite source n. */
  text: string;
  /** Prefix of the source anchors (unique per page). */
  idPrefix?: string;
  /** The sources, under the answer (usually a SourceList). */
  children?: ReactNode;
  className?: string;
}

/** An answer the assistant wrote from the company's own sources, marked as a draft (ADR 0026). */
export function AnswerCard({ text, idPrefix = 'source', children, className }: AnswerCardProps) {
  return (
    <section
      aria-label={t('ui.assistant.answer')}
      className={cn('flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-ink">{t('ui.assistant.answer')}</span>
        <AssistantBadge />
      </div>
      {text.split('\n').map((paragraph, i) => (
        <p key={i} className="leading-8 text-ink">
          <CitedText text={paragraph} idPrefix={idPrefix} />
        </p>
      ))}
      {children}
    </section>
  );
}

const KIND_ICONS: Record<KnowledgeKind, ReactNode> = {
  task: <ListTodo aria-hidden />,
  letter: <Mail aria-hidden />,
  meeting: <CalendarClock aria-hidden />,
  channel: <MessageCircle aria-hidden />,
};

export interface SourceItem {
  n: number;
  kind: KnowledgeKind;
  title: string;
  href: string;
  /** The answer refers to it; the others are shown quieter. */
  cited: boolean;
}

/** The numbered sources of an answer, each opening its own page. */
export function SourceList({
  items,
  idPrefix = 'source',
  Link = DefaultLink,
}: {
  items: SourceItem[];
  idPrefix?: string;
  Link?: LinkComponent;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-bold text-ink-muted">{t('ui.assistant.sources')}</h2>
      <ol className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.n}
            id={`${idPrefix}-${item.n}`}
            tabIndex={-1}
            className="scroll-mt-24 rounded-xl outline-none target:ring-2 target:ring-focus focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Link
              href={item.href}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 hover:bg-sunken',
                !item.cited && 'border-dashed',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                  item.cited ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink-subtle',
                )}
              >
                {formatNumber(item.n)}
              </span>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink [&_svg]:size-4">
                {KIND_ICONS[item.kind]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    'truncate font-semibold',
                    item.cited ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {item.title}
                </span>
                <span className="text-xs text-ink-subtle">
                  {t(`ui.assistant.kinds.${item.kind}`)}
                  {item.cited && <span className="sr-only">{t('ui.assistant.cited')}</span>}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface DraftCardProps {
  title: string;
  /** The draft itself (rendered by the caller, e.g. with LiteText). */
  children: ReactNode;
  /** «جایگزین متن», «کنار گذاشتن» and the like. */
  actions?: ReactNode;
  className?: string;
}

/** Something the assistant drafted for a person to use or drop (ADR 0025); never saved by itself. */
export function DraftCard({ title, children, actions, className }: DraftCardProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-accent-soft bg-surface p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-ink">{title}</span>
        <AssistantBadge />
      </div>
      <div className="text-ink">{children}</div>
      {actions && <div className="flex flex-wrap gap-2 border-t border-line pt-3">{actions}</div>}
    </section>
  );
}
