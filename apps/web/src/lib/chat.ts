import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { t } from '@madar/i18n';
import {
  formatJalaliDate,
  formatTime,
  mentionToken,
  mentionsAsText,
  type ConversationSummary,
  type Message,
  type ReactionEmoji,
  type MessagePage,
} from '@madar/shared';

import { chatKeys } from '@/hooks/keys';

/** Optimistic messages carry a temporary id until the server confirms them. */
export const PENDING_PREFIX = 'pending-';

export function isPending(message: Pick<Message, 'id'>): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

interface Pages {
  pages: MessagePage[];
  pageParams: Array<string | undefined>;
}

/**
 * Puts a message into the cached pages (pages[0] is the newest):
 * - a known id is replaced (edits, deletes, the server's copy of a sent message);
 * - my own message from the socket takes the place of its pending copy;
 * - an edit or delete of a message that is not loaded is ignored (it belongs to an older page);
 * - a new message goes into the newest page in id order (ids are UUIDv7, pending ids sort last).
 */
export function upsertMessage<T extends Pages>(data: T, message: Message): T {
  const all = data.pages.flatMap((p) => p.items);
  const replace = (id: string): T => ({
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((m) => (m.id === id ? message : m)),
    })),
  });
  if (all.some((m) => m.id === message.id)) return replace(message.id);
  if (!isPending(message)) {
    const pending = all.find(
      (m) => isPending(m) && m.author.id === message.author.id && m.body === message.body,
    );
    if (pending) return replace(pending.id);
    if (message.editedAt || message.deleted) return data;
  }
  const [first, ...rest] = data.pages;
  const items = [...(first?.items ?? []), message].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { ...data, pages: [{ hasMore: first?.hasMore ?? false, items }, ...rest] };
}

/** The cached copy of a message (the newest one, live updates included). */
export function findMessage(
  client: QueryClient,
  conversationId: string,
  messageId: string,
): Message | undefined {
  const data = client.getQueryData<InfiniteData<MessagePage, string | undefined>>(
    chatKeys.messages(conversationId),
  );
  return data?.pages.flatMap((p) => p.items).find((m) => m.id === messageId);
}

/** Merges a live (or just confirmed) message into its conversation's cache, if loaded. */
export function applyLiveMessage(client: QueryClient, message: Message): boolean {
  const key = chatKeys.messages(message.conversationId);
  const data = client.getQueryData<InfiniteData<MessagePage, string | undefined>>(key);
  if (!data) return false;
  client.setQueryData(key, upsertMessage(data, message));
  return true;
}

/** Oldest first, across pages (pages[0] is the newest page). */
export function flattenMessages(pages: MessagePage[]): Message[] {
  return [...pages].reverse().flatMap((p) => p.items);
}

export interface MessageGroup {
  day: string;
  items: Array<{ message: Message; showAuthor: boolean }>;
}

/** Groups by day (tenant time zone); the author shows once per run of messages. */
export function groupMessages(messages: Message[], timeZone?: string): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let lastAuthor: string | null = null;
  for (const message of messages) {
    const day = formatJalaliDate(new Date(message.createdAt), 'long', timeZone);
    let group = groups.at(-1);
    if (!group || group.day !== day) {
      group = { day, items: [] };
      groups.push(group);
      lastAuthor = null;
    }
    group.items.push({ message, showAuthor: message.author.id !== lastAuthor });
    lastAuthor = message.author.id;
  }
  return groups;
}

/** «امروز», «دیروز» or the date, then the time for lists. */
export function chatTime(iso: string, timeZone?: string, now = new Date()): string {
  const date = new Date(iso);
  const day = formatJalaliDate(date, 'short', timeZone);
  if (day === formatJalaliDate(now, 'short', timeZone)) return formatTime(date, timeZone);
  return formatJalaliDate(date, 'medium', timeZone);
}

export function conversationPreview(c: ConversationSummary, meId: string | undefined): string {
  const last = c.lastMessage;
  if (!last) return t('chat.noMessages');
  const names = new Map(last.mentions.map((m) => [m.id, m.displayName]));
  const body = mentionsAsText(last.body, names, t('ui.chat.someone')).replace(/\s+/g, ' ').trim();
  const text = last.deleted
    ? t('chat.deletedPreview')
    : body || (last.fileName ? t('chat.filePreview', { name: last.fileName }) : '');
  const name = last.author.id === meId ? t('chat.you') : last.author.displayName;
  return c.kind === 'direct' && last.author.id !== meId
    ? text
    : t('chat.previewBy', { name, text });
}

/** Reactions as the bar shows them, with «mine» for the viewer. */
export function reactionViews(message: Pick<Message, 'reactions'>, meId: string | undefined) {
  return message.reactions.map((r) => ({
    emoji: r.emoji,
    names: r.members.map((m) => m.displayName),
    mine: r.members.some((m) => m.id === meId),
  }));
}

/** The message with the viewer's reaction turned on or off (optimistic). */
export function toggleReaction(
  message: Message,
  emoji: ReactionEmoji,
  active: boolean,
  me: { id: string; displayName: string },
): Message {
  const others = message.reactions.map((r) =>
    r.emoji === emoji ? { ...r, members: r.members.filter((m) => m.id !== me.id) } : r,
  );
  const reactions = active
    ? others.some((r) => r.emoji === emoji)
      ? others.map((r) => (r.emoji === emoji ? { ...r, members: [...r.members, me] } : r))
      : [...others, { emoji, members: [me] }]
    : others;
  return { ...message, reactions: reactions.filter((r) => r.members.length > 0) };
}

/**
 * The «@name» being typed right before the caret, if any: an «@» at the start or after a space,
 * then up to 30 characters without a line break.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1] ?? ''))) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /\n/.test(query)) return null;
  return { start: at, query };
}

/** Arabic ي and ك (some keyboards) read as Persian ی and ک. */
function normalizeLetters(text: string): string {
  return text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
}

/** People whose name matches what was typed after «@» (any word may match). */
export function matchPeople<T extends { displayName: string }>(people: T[], query: string): T[] {
  const q = normalizeLetters(query.trim());
  if (!q) return people.slice(0, 8);
  return people.filter((p) => normalizeLetters(p.displayName).includes(q)).slice(0, 8);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The composer shows «@name»; the server gets `<@id>` for the people picked from the list. */
export function encodeMentions(
  text: string,
  picked: { id: string; displayName: string }[],
): string {
  let out = text;
  // Longer names first, so «علی رضایی» is not taken by a picked «علی».
  for (const p of [...picked].sort((a, b) => b.displayName.length - a.displayName.length)) {
    // Only the whole name: «@علی» must not take the start of a typed «@علی رضایی».
    const name = new RegExp(`@${escapeRegExp(p.displayName)}(?=$|[\\s.,!?؟،؛:)])`, 'g');
    out = out.replace(name, mentionToken(p.id));
  }
  return out;
}

/** The other way, for editing a sent message. */
export function decodeMentions(body: string, mentions: { id: string; displayName: string }[]) {
  const names = new Map(mentions.map((m) => [m.id, m.displayName]));
  return mentionsAsText(body, names, t('ui.chat.someone'));
}
