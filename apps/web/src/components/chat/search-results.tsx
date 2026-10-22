'use client';

import Link from 'next/link';

import { t } from '@madar/i18n';
import { Button, ConversationAvatar, Skeleton } from '@madar/ui';

import { useChatSearch } from '@/hooks/chat';
import { useMe } from '@/hooks/use-me';
import { chatTime, highlightParts } from '@/lib/chat';

/**
 * Messages that contain the words (plan phase-2-step-15c): who, where, when, and the text around
 * the match with the words in bold. A result opens the conversation around that message.
 */
export function SearchResults({
  query,
  conversationId,
  onPick,
}: {
  query: string;
  /** Only this conversation (search from inside it). */
  conversationId?: string;
  onPick?: () => void;
}) {
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useChatSearch(
    query,
    conversationId,
  );
  const { data: me } = useMe();
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (query.trim().length < 2) return null;
  return (
    <section aria-label={t('chat.searchMessages')} className="flex flex-col gap-2">
      {!conversationId && (
        <h2 className="px-1 text-sm font-bold text-ink-muted">{t('chat.searchMessages')}</h2>
      )}
      {isPending ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : !items.length ? (
        <p className="px-1 py-2 text-sm text-ink-muted">{t('chat.searchEmpty')}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((r) => (
            <li key={r.message.id}>
              <Link
                href={`/chat/${r.conversation.id}?m=${r.message.id}`}
                onClick={onPick}
                className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
              >
                <ConversationAvatar
                  kind={r.conversation.kind}
                  title={r.conversation.title}
                  size="sm"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-xs text-ink-subtle">
                    <span className="truncate font-semibold text-ink">
                      {r.message.author.displayName}
                    </span>
                    {!conversationId && <span className="truncate">{r.conversation.title}</span>}
                    <span className="ms-auto shrink-0">
                      {chatTime(r.message.createdAt, me?.tenant?.timezone)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-sm text-ink-muted">
                    {highlightParts(r.message.excerpt, query).map((part, i) =>
                      part.match ? (
                        <mark
                          key={i}
                          className="rounded bg-primary-soft px-0.5 font-bold text-primary-ink"
                        >
                          {part.text}
                        </mark>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
          loading={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {t('chat.searchMore')}
        </Button>
      )}
    </section>
  );
}
