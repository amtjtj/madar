import { t } from '@madar/i18n';
import { formatNumber, messageSegments, type ConversationKind } from '@madar/shared';
import { BellOff, Building2, Check, Clock, FolderKanban, Reply, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { Avatar } from './avatar.js';
import type { LinkComponent } from './navigation.js';

export interface MentionRef {
  id: string;
  displayName: string;
}

/**
 * Message text: plain text with http(s) links and `<@id>` mentions as elements; never HTML
 * (ADR 0022). Mentions show the person's current name; a token without a known person reads as
 * «@کسی».
 */
export function MessageText({
  body,
  mentions = [],
  meId,
  className,
}: {
  body: string;
  mentions?: readonly MentionRef[];
  /** Mentions of this person stand out a little more. */
  meId?: string;
  className?: string;
}) {
  const names = new Map(mentions.map((m) => [m.id, m.displayName]));
  return (
    <span className={cn('break-words whitespace-pre-wrap', className)}>
      {messageSegments(body).map((part, i) =>
        part.type === 'mention' ? (
          <span
            key={i}
            className={cn(
              'font-bold',
              part.id === meId ? 'rounded bg-primary-soft px-1 text-primary-ink' : 'text-current',
            )}
          >
            @{names.get(part.id) ?? t('ui.chat.someone')}
          </span>
        ) : part.type === 'link' ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            dir="ltr"
            className="underline underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

const KIND_ICON: Record<Exclude<ConversationKind, 'direct'>, ReactNode> = {
  project: <FolderKanban aria-hidden />,
  department: <Building2 aria-hidden />,
  group: <Users aria-hidden />,
};

export function ConversationAvatar({
  kind,
  title,
  size = 'md',
}: {
  kind: ConversationKind;
  title: string;
  size?: 'sm' | 'md';
}) {
  if (kind === 'direct') return <Avatar name={title} size={size} />;
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink',
        size === 'md' ? 'size-10 [&_svg]:size-5' : 'size-8 [&_svg]:size-4',
      )}
    >
      {KIND_ICON[kind]}
    </span>
  );
}

export interface ConversationRowProps {
  href: string;
  kind: ConversationKind;
  title: string;
  /** «علی: متن آخرین پیام», already worded. */
  preview?: string;
  /** Short time or date, already formatted. */
  time?: string;
  unread: number;
  muted?: boolean;
  active?: boolean;
  Link?: LinkComponent;
  className?: string;
}

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

export function ConversationRow({
  href,
  kind,
  title,
  preview,
  time,
  unread,
  muted,
  active,
  Link = DefaultLink,
  className,
}: ConversationRowProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus',
        active && 'bg-primary-soft/50',
        className,
      )}
    >
      <ConversationAvatar kind={kind} title={title} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className={cn('truncate text-ink', unread > 0 ? 'font-bold' : 'font-medium')}>
            {title}
          </span>
          {muted && (
            <BellOff
              aria-label={t('ui.chat.muted')}
              className="size-3.5 shrink-0 text-ink-subtle"
            />
          )}
          {time && <span className="ms-auto shrink-0 text-xs text-ink-subtle">{time}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-ink-muted">{preview}</span>
          {unread > 0 && (
            <span
              className={cn(
                'ms-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[0.6875rem] font-bold',
                muted ? 'bg-sunken text-ink-muted' : 'bg-primary text-on-primary',
              )}
            >
              <span className="sr-only">
                {t('ui.chat.unread', { count: formatNumber(unread) })}
              </span>
              <span aria-hidden>{formatNumber(Math.min(unread, 99))}</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

export function DayDivider({ label }: { label: string }) {
  return (
    <div role="separator" className="my-3 flex items-center gap-3 text-xs text-ink-subtle">
      <span className="h-px flex-1 bg-line" />
      <span className="rounded-full bg-sunken px-3 py-1">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export interface MessageBubbleProps {
  mine: boolean;
  /** Shown for others' messages when the author changes. */
  author?: string;
  body: string;
  time: string;
  edited?: boolean;
  deleted?: boolean;
  /** Not yet confirmed by the server. */
  pending?: boolean;
  replyTo?: { author: string; body: string; deleted: boolean } | null;
  /** Menu button (reply, edit, delete). */
  actions?: ReactNode;
}

export function MessageBubble({
  mine,
  author,
  body,
  time,
  edited,
  deleted,
  pending,
  replyTo,
  actions,
}: MessageBubbleProps) {
  return (
    <div className={cn('group flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
      {!mine && (
        <span className="w-8 shrink-0">{author && <Avatar name={author} size="sm" />}</span>
      )}
      <div
        className={cn(
          'relative max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-6 md:max-w-[65%]',
          mine
            ? 'rounded-ee-md bg-primary text-on-primary'
            : 'rounded-es-md border border-line bg-surface text-ink',
          pending && 'opacity-70',
        )}
      >
        {!mine && author && <p className="mb-0.5 text-xs font-bold text-primary-ink">{author}</p>}
        {replyTo && (
          <div
            className={cn(
              'mb-1.5 flex gap-1.5 rounded-lg border-s-4 px-2 py-1 text-xs [&_svg]:size-3.5',
              mine ? 'border-on-primary/60 bg-on-primary/15' : 'border-primary bg-sunken',
            )}
          >
            <Reply aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block font-bold">{replyTo.author}</span>
              <span className="line-clamp-2">
                {replyTo.deleted ? t('ui.chat.deleted') : replyTo.body}
              </span>
            </span>
          </div>
        )}
        {deleted ? (
          <p className="italic opacity-80">{t('ui.chat.deleted')}</p>
        ) : (
          <MessageText body={body} />
        )}
        <span
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem] [&_svg]:size-3',
            mine ? 'text-on-primary/80' : 'text-ink-subtle',
          )}
        >
          {edited && !deleted && <span>{t('ui.chat.edited')}</span>}
          <span>{time}</span>
          {mine &&
            (pending ? (
              <Clock aria-label={t('ui.chat.sending')} />
            ) : (
              <Check aria-label={t('ui.chat.sent')} />
            ))}
        </span>
      </div>
      {actions && (
        <span className="opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {actions}
        </span>
      )}
    </div>
  );
}
