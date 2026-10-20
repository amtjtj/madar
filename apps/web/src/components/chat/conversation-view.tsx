'use client';

import { ArrowRight, Info, MoreVertical, Pencil, Reply, Send, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { t } from '@madar/i18n';
import { MESSAGE_MAX, canStillEdit, formatNumber, formatTime, type Message } from '@madar/shared';
import {
  Button,
  ConversationAvatar,
  DayDivider,
  EmptyState,
  Menu,
  MessageBubble,
  Modal,
  Skeleton,
  useToast,
} from '@madar/ui';

import { ApiClientError } from '@/lib/api';
import {
  useConversation,
  useDeleteMessage,
  useEditMessage,
  useMarkRead,
  useMessages,
  useSendMessage,
} from '@/hooks/chat';
import { useMe } from '@/hooks/use-me';
import { PENDING_PREFIX, flattenMessages, groupMessages, isPending } from '@/lib/chat';
import { errorMessage } from '@/lib/errors';

import { ConversationInfo } from './conversation-info';

/** One conversation: header, messages by day, the «unread» line, and the composer. */
export function ConversationView({ id }: { id: string }) {
  const { data: conversation, isPending: loading, isError, error } = useConversation(id);
  const messages = useMessages(id);
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const meRef = me?.member
    ? { id: me.member.id, displayName: me.member.displayName }
    : { id: '', displayName: '' };
  const send = useSendMessage(id, meRef);
  const edit = useEditMessage();
  const remove = useDeleteMessage();
  const markRead = useMarkRead(id);
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  // The read mark when the conversation opened: the «unread» line stays there while it is open.
  const [unreadAfter, setUnreadAfter] = useState<string | null | undefined>(undefined);
  if (conversation && unreadAfter === undefined) setUnreadAfter(conversation.lastReadMessageId);

  const all = flattenMessages(messages.data?.pages ?? []);
  const lastId = all.filter((m) => !isPending(m)).at(-1)?.id;

  // Stick to the bottom when new messages arrive, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  // Seeing the newest message moves the read mark forward: when it arrives while the person is
  // at the bottom, when they scroll back down, and when they return to the tab.
  const marked = useRef<string | null>(null);
  const latest = useRef<string | undefined>(undefined);
  const mark = useRef(() => {});
  useEffect(() => {
    latest.current = lastId;
    mark.current = () => {
      const id = latest.current;
      if (!id || marked.current === id || !nearBottom.current) return;
      if (document.visibilityState !== 'visible') return;
      marked.current = id;
      markRead.mutate(id);
    };
    mark.current();
  }, [lastId, markRead]);
  useEffect(() => {
    const onVisible = () => mark.current();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const onError = (err: unknown) => toast({ tone: 'error', title: errorMessage(err) });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      edit.mutate({ id: editing.id, body }, { onError });
      setEditing(null);
    } else {
      send.mutate({ body, replyTo, tempId: `${PENDING_PREFIX}${Date.now()}` }, { onError });
      setReplyTo(null);
      nearBottom.current = true;
    }
    setText('');
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      setReplyTo(null);
      setEditing(null);
    }
  };

  const back = (
    <Link
      href="/chat"
      aria-label={t('chat.back')}
      className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken md:hidden [&_svg]:size-5"
    >
      <ArrowRight aria-hidden />
    </Link>
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3" aria-busy>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="flex-1 rounded-2xl" />
      </div>
    );
  }
  if (isError || !conversation) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <EmptyState
          title={
            error instanceof ApiClientError && error.status === 404
              ? t('chat.notFound')
              : errorMessage(error)
          }
        />
      </div>
    );
  }

  const groups = groupMessages(all, timeZone);
  // The first message from someone else after the read mark the conversation opened with.
  const firstUnreadId = unreadAfter
    ? all.find((m) => m.id > unreadAfter && m.author.id !== me?.member?.id && !isPending(m))?.id
    : undefined;
  return (
    <section aria-label={conversation.title} className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line pb-3">
        {back}
        <ConversationAvatar kind={conversation.kind} title={conversation.title} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-bold text-ink">{conversation.title}</h1>
          <p className="truncate text-xs text-ink-muted">
            {t(`chat.kinds.${conversation.kind}`)}
            {conversation.kind !== 'direct' &&
              `${t('ui.listSeparator')}${t('chat.members', { count: formatNumber(conversation.members.length) })}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label={t('chat.info')}
          className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-5"
        >
          <Info aria-hidden />
        </button>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (nearBottom.current) mark.current();
        }}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto py-3"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            loading={messages.isFetchingNextPage}
            onClick={() => {
              nearBottom.current = false;
              void messages.fetchNextPage();
            }}
          >
            {t('chat.loadOlder')}
          </Button>
        )}
        {messages.isPending ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : !all.length ? (
          <p className="m-auto text-sm text-ink-muted">{t('chat.noMessages')}</p>
        ) : (
          groups.map((group) => (
            <div key={group.day} className="flex flex-col gap-1.5">
              <DayDivider label={group.day} />
              {group.items.map(({ message, showAuthor }) => {
                const mine = message.author.id === me?.member?.id;
                const editable =
                  mine &&
                  !message.deleted &&
                  !isPending(message) &&
                  canStillEdit(message.createdAt);
                const showUnread = message.id === firstUnreadId;
                return (
                  <div key={message.id} className="flex flex-col gap-1.5">
                    {showUnread && (
                      <p className="my-1 text-center text-xs font-bold text-primary-ink">
                        {t('chat.unreadLine')}
                      </p>
                    )}
                    <MessageBubble
                      mine={mine}
                      author={!mine && showAuthor ? message.author.displayName : undefined}
                      body={message.body}
                      time={formatTime(new Date(message.createdAt), timeZone)}
                      edited={Boolean(message.editedAt)}
                      deleted={message.deleted}
                      pending={isPending(message)}
                      replyTo={
                        message.replyTo
                          ? {
                              author: message.replyTo.author.displayName,
                              body: message.replyTo.body,
                              deleted: message.replyTo.deleted,
                            }
                          : null
                      }
                      actions={
                        message.deleted || isPending(message) ? undefined : (
                          <Menu
                            label={t('chat.actions')}
                            trigger={
                              <button
                                type="button"
                                aria-label={t('chat.actions')}
                                className="grid size-8 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-4"
                              >
                                <MoreVertical aria-hidden />
                              </button>
                            }
                            items={[
                              ...(conversation.can.post
                                ? [
                                    {
                                      key: 'reply',
                                      label: t('chat.reply'),
                                      icon: <Reply aria-hidden />,
                                      onSelect: () => {
                                        setEditing(null);
                                        setReplyTo(message);
                                        input.current?.focus();
                                      },
                                    },
                                  ]
                                : []),
                              ...(editable
                                ? [
                                    {
                                      key: 'edit',
                                      label: t('chat.edit'),
                                      icon: <Pencil aria-hidden />,
                                      onSelect: () => {
                                        setReplyTo(null);
                                        setEditing(message);
                                        setText(message.body);
                                        input.current?.focus();
                                      },
                                    },
                                    {
                                      key: 'delete',
                                      label: t('chat.delete'),
                                      icon: <Trash2 aria-hidden />,
                                      tone: 'danger' as const,
                                      onSelect: () => setDeleting(message),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {conversation.can.post ? (
        <form
          aria-label={t('chat.composer')}
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {(replyTo || editing) && (
            <div className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-xs text-ink-muted">
              {replyTo ? (
                <Reply aria-hidden className="size-3.5" />
              ) : (
                <Pencil aria-hidden className="size-3.5" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {replyTo
                  ? `${t('chat.replyingTo', { name: replyTo.author.displayName })}: ${replyTo.body}`
                  : t('chat.editing')}
              </span>
              <button
                type="button"
                aria-label={replyTo ? t('chat.cancelReply') : t('chat.cancelEdit')}
                onClick={() => {
                  setReplyTo(null);
                  if (editing) setText('');
                  setEditing(null);
                }}
                className="grid size-7 place-items-center rounded-full hover:bg-surface [&_svg]:size-3.5"
              >
                <X aria-hidden />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label htmlFor={`composer-${id}`} className="sr-only">
              {t('chat.placeholder')}
            </label>
            <textarea
              id={`composer-${id}`}
              ref={input}
              rows={1}
              maxLength={MESSAGE_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('chat.placeholder')}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-focus [field-sizing:content]"
            />
            <Button
              type="submit"
              size="icon"
              aria-label={t('chat.send')}
              disabled={!text.trim()}
              icon={<Send aria-hidden className="rtl:-scale-x-100" />}
            />
          </div>
        </form>
      ) : (
        <p className="border-t border-line pt-3 text-center text-sm text-ink-muted">
          {t('chat.readOnly')}
        </p>
      )}

      <ConversationInfo conversation={conversation} open={infoOpen} onOpenChange={setInfoOpen} />
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('chat.deleteTitle')}
        description={t('chat.deleteBody')}
      >
        <div className="flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              if (deleting) remove.mutate(deleting, { onError });
              setDeleting(null);
            }}
          >
            {t('chat.deleteConfirm')}
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            {t('chat.cancel')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
