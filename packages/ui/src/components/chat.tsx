'use client';

import { t } from '@madar/i18n';
import {
  REACTION_EMOJIS,
  formatNumber,
  messageSegments,
  type ConversationKind,
  type ReactionEmoji,
} from '@madar/shared';
import { BellOff, Building2, Check, Clock, FolderKanban, Reply, Users } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

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
  /** An unread message mentions the person: «@» beside the count. */
  mentioned?: boolean;
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
  mentioned,
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
          {mentioned && (
            <span
              role="img"
              aria-label={t('ui.chat.mentioned')}
              className="ms-auto grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[0.6875rem] font-bold text-on-primary"
            >
              @
            </span>
          )}
          {unread > 0 && (
            <span
              className={cn(
                'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[0.6875rem] font-bold',
                !mentioned && 'ms-auto',
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
  /** People the body's `<@id>` tokens name. */
  mentions?: readonly MentionRef[];
  /** The viewer, whose own mentions stand out. */
  meId?: string;
  /** Files and images, inside the bubble above the text. */
  attachments?: ReactNode;
  /** Reactions, under the bubble. */
  reactions?: ReactNode;
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
  mentions,
  meId,
  attachments,
  reactions,
  actions,
}: MessageBubbleProps) {
  return (
    <div className={cn('group flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
      {!mine && (
        <span className="w-8 shrink-0">{author && <Avatar name={author} size="sm" />}</span>
      )}
      <div
        className={cn(
          'flex max-w-[80%] flex-col gap-1 md:max-w-[65%]',
          mine ? 'items-end' : 'items-start',
        )}
      >
        <div
          className={cn(
            'relative max-w-full rounded-2xl px-3.5 py-2 text-sm leading-6',
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
            <>
              {attachments && <div className={cn('py-1', body && 'mb-1')}>{attachments}</div>}
              {body && <MessageText body={body} mentions={mentions} meId={meId} />}
            </>
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
        {!deleted && reactions}
      </div>
      {actions && (
        <span className="opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {actions}
        </span>
      )}
    </div>
  );
}

export interface ReactionView {
  emoji: ReactionEmoji;
  /** Names of the people who reacted, in order. */
  names: string[];
  mine: boolean;
}

/**
 * Reactions under a message: «👍 ۳». A chip toggles the person's own reaction; without
 * `onToggle` (people who only read) chips are not buttons.
 */
export function ReactionBar({
  reactions,
  onToggle,
  className,
}: {
  reactions: readonly ReactionView[];
  onToggle?: (emoji: ReactionEmoji, active: boolean) => void;
  className?: string;
}) {
  // Phones have no hover: a long press (or a tap for people who only read) shows the names.
  const [shown, setShown] = useState<ReactionEmoji | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const press = (emoji: ReactionEmoji) => {
    longPressed.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setShown(emoji);
    }, 500);
  };
  const release = () => clearTimeout(timer.current);
  if (!reactions.length) return null;
  const names = reactions.find((r) => r.emoji === shown)?.names;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <ul aria-label={t('ui.chat.reactions')} className="flex flex-wrap gap-1">
        {reactions.map((r) => {
          const label = t('ui.chat.reaction', {
            emoji: r.emoji,
            count: formatNumber(r.names.length),
            names: r.names.join(t('ui.listSeparator')),
          });
          const content = (
            <>
              <span aria-hidden>{r.emoji}</span>
              <span aria-hidden className="tabular-nums">
                {formatNumber(r.names.length)}
              </span>
            </>
          );
          const chip = cn(
            'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs font-semibold',
            r.mine
              ? 'border-primary bg-primary-soft text-primary-ink'
              : 'border-line bg-surface text-ink-muted',
          );
          return (
            <li key={r.emoji}>
              {onToggle ? (
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={r.mine}
                  title={r.names.join(t('ui.listSeparator'))}
                  onPointerDown={() => press(r.emoji)}
                  onPointerUp={release}
                  onPointerLeave={release}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (longPressed.current) {
                      longPressed.current = false;
                      return;
                    }
                    setShown(null);
                    onToggle(r.emoji, !r.mine);
                  }}
                  className={cn(
                    chip,
                    'transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-focus',
                  )}
                >
                  {content}
                </button>
              ) : (
                <span
                  role="img"
                  aria-label={label}
                  title={r.names.join(t('ui.listSeparator'))}
                  onClick={() => setShown((now) => (now === r.emoji ? null : r.emoji))}
                  className={cn(chip, 'cursor-pointer')}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {names && (
        <p aria-hidden className="max-w-64 text-xs text-ink-muted">
          {shown} {names.join(t('ui.listSeparator'))}
        </p>
      )}
    </div>
  );
}

/** The six reactions to pick from (plan 15b: a fixed set). */
export function ReactionPicker({
  mine = [],
  onPick,
  className,
}: {
  /** Emoji the person already used on this message. */
  mine?: readonly ReactionEmoji[];
  onPick: (emoji: ReactionEmoji, active: boolean) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={t('ui.chat.react')} className={cn('flex gap-1', className)}>
      {REACTION_EMOJIS.map((emoji) => {
        const active = mine.includes(emoji);
        return (
          <button
            key={emoji}
            type="button"
            aria-label={t('ui.chat.reactWith', { emoji })}
            aria-pressed={active}
            onClick={() => onPick(emoji, !active)}
            className={cn(
              'grid size-10 place-items-center rounded-full text-xl transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-focus',
              active ? 'bg-primary-soft' : 'hover:bg-sunken',
            )}
          >
            <span aria-hidden>{emoji}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * People to mention, shown above the composer while typing «@…». The composer keeps focus and
 * drives `activeIndex` with the arrow keys (ARIA combobox pattern: the input points at this list).
 */
export function MentionSuggestions({
  id,
  people,
  activeIndex,
  onPick,
  className,
}: {
  id: string;
  people: readonly MentionRef[];
  activeIndex: number;
  onPick: (person: MentionRef) => void;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface p-1 shadow-lg', className)}>
      {people.length === 0 ? (
        <p className="px-3 py-2 text-sm text-ink-muted">{t('ui.chat.noPeople')}</p>
      ) : (
        <ul
          id={id}
          role="listbox"
          aria-label={t('ui.chat.mentionList')}
          className="max-h-56 overflow-y-auto"
        >
          {people.map((p, i) => (
            <li
              key={p.id}
              id={`${id}-${p.id}`}
              role="option"
              aria-selected={i === activeIndex}
              // Keep the composer focused: pick on mouse down, before it would blur.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(p);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink',
                i === activeIndex ? 'bg-primary-soft' : 'hover:bg-sunken',
              )}
            >
              <Avatar name={p.displayName} size="sm" />
              <span className="truncate font-medium">{p.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
