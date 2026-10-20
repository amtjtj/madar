import { t } from '@madar/i18n';
import {
  formatJalaliDate,
  formatTime,
  type ConversationSummary,
  type Message,
  type MessagePage,
} from '@madar/shared';

/** Optimistic messages carry a temporary id until the server confirms them. */
export const PENDING_PREFIX = 'pending-';

export function isPending(message: Pick<Message, 'id'>): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

interface Pages {
  pages: MessagePage[];
  pageParams: Array<string | undefined>;
}

/** Inserts or replaces a message; the newest page (index 0) gets new ones at its end. */
export function upsertMessage<T extends Pages>(data: T, message: Message): T {
  const exists = data.pages.some((p) => p.items.some((m) => m.id === message.id));
  if (exists) {
    return {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        items: p.items.map((m) => (m.id === message.id ? message : m)),
      })),
    };
  }
  const [first, ...rest] = data.pages;
  const items = [...(first?.items ?? []), message];
  return { ...data, pages: [{ hasMore: first?.hasMore ?? false, items }, ...rest] };
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
  const text = last.deleted ? t('chat.deletedPreview') : last.body.replace(/\s+/g, ' ');
  const name = last.author.id === meId ? t('chat.you') : last.author.displayName;
  return c.kind === 'direct' && last.author.id !== meId
    ? text
    : t('chat.previewBy', { name, text });
}
