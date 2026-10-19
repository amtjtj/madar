import { t } from '@madar/i18n';
import { formatNumber, type EvidenceAudience, type EvidenceSummary } from '@madar/shared';
import { Check, Clock, Eye, Mail, Paperclip, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { LetterNumber, UrgencyBadge } from './letter.js';

export interface EvidenceCardProps {
  /** Null when the item is no longer available. */
  summary: EvidenceSummary | null;
  /** Short Jalali date, already formatted. */
  date?: string;
  /** «سنجاق: علی رضایی، ۵ دقیقه پیش», already worded. */
  meta?: string;
  onOpen?: () => void;
  onUnpin?: () => void;
  className?: string;
}

/**
 * A letter pinned to a task as «شاهد کار» (ADR 0021): subject, number, who to whom, date and one
 * read flag (never who read it).
 */
export function EvidenceCard({
  summary,
  date,
  meta,
  onOpen,
  onUnpin,
  className,
}: EvidenceCardProps) {
  const unpin = onUnpin && (
    <button
      type="button"
      onClick={onUnpin}
      aria-label={t('evidence.unpin', { subject: summary?.subject ?? '' })}
      className="grid size-9 shrink-0 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-4"
    >
      <X aria-hidden />
    </button>
  );
  if (!summary) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border border-dashed border-line bg-sunken p-3 text-sm text-ink-muted',
          className,
        )}
      >
        <Mail aria-hidden className="size-5 shrink-0" />
        <span className="flex-1">{t('evidence.unavailable')}</span>
        {unpin}
      </div>
    );
  }
  const body: ReactNode = (
    <>
      <span className="flex items-center gap-2">
        <span className="truncate font-semibold text-ink">{summary.subject}</span>
        <UrgencyBadge urgency={summary.urgency} />
      </span>
      <span className="truncate text-sm text-ink-muted">
        {t('evidence.fromTo', {
          from: summary.sender.displayName,
          to: summary.to.map((p) => p.displayName).join(t('ui.listSeparator')),
        })}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
        {summary.number && <LetterNumber value={summary.number} />}
        {date && <span>{date}</span>}
        <span
          className={cn(
            'inline-flex items-center gap-0.5 [&_svg]:size-3.5',
            summary.read ? 'text-success-ink' : 'text-ink-subtle',
          )}
        >
          {summary.read ? <Check aria-hidden /> : <Clock aria-hidden />}
          {t(summary.read ? 'evidence.read' : 'evidence.notRead')}
        </span>
        {summary.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 [&_svg]:size-3.5">
            <Paperclip aria-hidden />
            {t('ui.letter.attachments', { count: formatNumber(summary.attachmentCount) })}
          </span>
        )}
      </span>
      {meta && <span className="text-xs text-ink-subtle">{meta}</span>}
    </>
  );
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-line bg-surface p-3',
        className,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-info-soft text-info-ink [&_svg]:size-5">
        <Mail aria-hidden />
      </span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('evidence.open', { subject: summary.subject })}
          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg text-start focus-visible:outline-2 focus-visible:outline-focus"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">{body}</span>
      )}
      {unpin}
    </div>
  );
}

/** «چه کسانی خواهند دید»: the people on the task by name, the rest as groups. */
export function AudienceNote({
  audience,
  className,
}: {
  audience: EvidenceAudience;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        'flex flex-col gap-2 rounded-xl bg-info-soft p-3 text-sm text-info-ink',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-bold [&_svg]:size-4">
        <Eye aria-hidden />
        {t('evidence.audienceTitle')}
      </p>
      <p>{t('evidence.audienceIntro')}</p>
      <ul className="flex flex-col gap-1 ps-5 marker:text-info-ink [list-style:disc]">
        {audience.people.map((p) => (
          <li key={p.id}>
            {p.displayName} ({t(`evidence.roles.${p.role}`)})
          </li>
        ))}
        {audience.groups.map((g) => (
          <li key={g.kind}>{t(`evidence.groups.${g.kind}`, { name: g.name ?? '' })}</li>
        ))}
      </ul>
    </div>
  );
}
