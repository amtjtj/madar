import { t } from '@madar/i18n';
import {
  formatNumber,
  parseLiteText,
  toPersianDigits,
  type LetterUrgency,
  type LiteInline,
} from '@madar/shared';
import { Check, Clock, Lock, Paperclip, X, Zap } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { Avatar } from './avatar.js';
import { Badge } from './badge.js';
import type { LinkComponent } from './navigation.js';

function Runs({ runs }: { runs: LiteInline[] }) {
  return (
    <>
      {runs.map((run, i) =>
        run.bold ? (
          <strong key={i} className="font-bold">
            {run.text}
          </strong>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}

export interface LiteTextProps {
  text: string;
  className?: string;
}

/**
 * A letter body (ADR 0020): paragraphs, lists and bold, built from React elements only. The text
 * is never parsed as HTML, so `<script>` shows up as the characters a person typed.
 */
export function LiteText({ text, className }: LiteTextProps) {
  return (
    <div className={cn('space-y-3 leading-8 break-words text-ink', className)}>
      {parseLiteText(text).map((block, i) =>
        block.type === 'list' ? (
          <ul key={i} className="list-disc space-y-1 ps-6 marker:text-ink-subtle">
            {block.items.map((item, j) => (
              <li key={j}>
                <Runs runs={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Runs runs={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

/** «فوری» or «آنی»; nothing for a normal letter. */
export function UrgencyBadge({
  urgency,
  className,
}: {
  urgency: LetterUrgency;
  className?: string;
}) {
  if (urgency === 'normal') return null;
  return (
    <Badge tone={urgency === 'immediate' ? 'danger' : 'warning'} className={className}>
      {urgency === 'immediate' ? <Zap aria-hidden /> : <Clock aria-hidden />}
      {t(`ui.letter.urgency.${urgency}`)}
    </Badge>
  );
}

export function ConfidentialBadge({ className }: { className?: string }) {
  return (
    <Badge tone="accent" className={className}>
      <Lock aria-hidden />
      {t('ui.letter.confidential')}
    </Badge>
  );
}

/** «۱۴۰۵/۰۰۰۴۲», kept left-to-right so the year stays first. */
export function LetterNumber({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('tabular-nums', className)}>
      {toPersianDigits(value)}
    </bdi>
  );
}

export interface LetterRowProps {
  href: string;
  /** The sender, or the recipients in the sent folder (already worded). */
  person: string;
  subject: string;
  preview?: string;
  number?: string | null;
  /** Short Jalali date, already formatted. */
  date: string;
  urgency: LetterUrgency;
  confidential: boolean;
  attachmentCount: number;
  unread?: boolean;
  /** «ارجاع» or «رونوشت»: how the person got it. */
  tag?: string;
  Link?: LinkComponent;
  className?: string;
}

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

/** One letter in a folder: unread letters are bold with a dot. */
export function LetterRow({
  href,
  person,
  subject,
  preview,
  number,
  date,
  urgency,
  confidential,
  attachmentCount,
  unread = false,
  tag,
  Link = DefaultLink,
  className,
}: LetterRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-16 items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus',
        unread && 'bg-primary-soft/40',
        className,
      )}
    >
      <Avatar name={person} size="md" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {unread && (
            <span className="size-2 shrink-0 rounded-full bg-primary">
              <span className="sr-only">{t('ui.letter.unread')}</span>
            </span>
          )}
          <span className={cn('truncate text-ink', unread ? 'font-bold' : 'font-medium')}>
            {person}
          </span>
          <span className="ms-auto shrink-0 text-xs text-ink-subtle">{date}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('truncate text-sm', unread ? 'font-bold text-ink' : 'text-ink')}>
            {subject || t('ui.letter.noSubject')}
          </span>
        </span>
        {preview && <span className="mt-0.5 block truncate text-sm text-ink-muted">{preview}</span>}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
          {number && <LetterNumber value={number} />}
          <UrgencyBadge urgency={urgency} />
          {confidential && <ConfidentialBadge />}
          {tag && <Badge tone="info">{tag}</Badge>}
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 [&_svg]:size-3.5">
              <Paperclip aria-hidden />
              <span className="sr-only">
                {t('ui.letter.attachments', { count: formatNumber(attachmentCount) })}
              </span>
              <span aria-hidden>{formatNumber(attachmentCount)}</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

export interface RecipientChipProps {
  name: string;
  /** Shown to the sender: whether this person has opened it. */
  read?: boolean;
  onRemove?: () => void;
  /** Extra text after the name («رونوشت»). */
  note?: ReactNode;
  className?: string;
}

/** A person on a letter: in the composer (removable) or the header (with read state). */
export function RecipientChip({ name, read, onRemove, note, className }: RecipientChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface ps-1 pe-2.5 text-sm text-ink',
        onRemove && 'pe-1',
        className,
      )}
    >
      <Avatar name={name} size="xs" />
      <span className="truncate">{name}</span>
      {note && <span className="text-ink-subtle">{note}</span>}
      {read !== undefined && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 text-xs [&_svg]:size-3.5',
            read ? 'text-success-ink' : 'text-ink-subtle',
          )}
        >
          {read && <Check aria-hidden />}
          {t(read ? 'ui.letter.read' : 'ui.letter.notRead')}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('ui.letter.removeRecipient', { name })}
          className="grid size-6 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-3.5"
        >
          <X aria-hidden />
        </button>
      )}
    </span>
  );
}
