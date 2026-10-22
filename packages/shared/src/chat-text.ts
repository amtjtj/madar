/**
 * Chat message text (plan phase-2-step-15a, ADR 0022): plain text, never HTML. Links are found
 * here so the web renders them as elements; only http and https become links.
 */
export const MESSAGE_MAX = 4000;
/** Authors may edit or delete a message for this long. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60_000;

/** Files one message may carry (plan phase-2-step-15b). */
export const MESSAGE_FILES_MAX = 10;
/** The fixed reaction set (product owner, plan 15b question 3). */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export type MessageSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'mention'; id: string };

/**
 * A mention is stored in the body as `<@member-id>` and shown with the person's current name, so a
 * renamed person reads right in old messages too.
 */
const MENTION = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g;

export function mentionToken(memberId: string): string {
  return `<@${memberId}>`;
}

/** Member ids mentioned in a body, each once, in order. */
export function mentionIdsIn(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[1] as string))];
}

/**
 * Plain text with names for previews and notifications. A token without a known person keeps no
 * id visible: it reads as the fallback.
 */
export function mentionsAsText(
  body: string,
  names: ReadonlyMap<string, string>,
  fallback = '…',
): string {
  return body.replace(MENTION, (_, id: string) => `@${names.get(id) ?? fallback}`);
}

const LINK = /\bhttps?:\/\/[^\s<>"'«»]+/gi;
/** Punctuation that usually ends a sentence, not a link. */
const TRAILING = /[.,;:!?؟،؛)\]]+$/;

/** Text, links and mentions, in order. */
export function messageSegments(body: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const start = match.index ?? 0;
    if (start > last) segments.push(...linkSegments(body.slice(last, start)));
    segments.push({ type: 'mention', id: match[1] as string });
    last = start + match[0].length;
  }
  if (last < body.length) segments.push(...linkSegments(body.slice(last)));
  return segments;
}

function linkSegments(body: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    const start = match.index ?? 0;
    let href = match[0];
    const trailing = TRAILING.exec(href)?.[0] ?? '';
    if (trailing) href = href.slice(0, -trailing.length);
    if (start > last) segments.push({ type: 'text', text: body.slice(last, start) });
    // The pattern only matches http(s) at the start, so `javascript:` and friends never link.
    segments.push({ type: 'link', text: href, href });
    last = start + href.length;
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) });
  return segments;
}

/** The one key of a two-person conversation, whatever the order. */
export function directKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export function canStillEdit(createdAt: Date | string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;
}

/** A task title from a message: its first non-empty line, mentions as names, at most 120 characters. */
export function taskTitleFromMessage(body: string, names: ReadonlyMap<string, string>): string {
  const text = mentionsAsText(body, names);
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

/** One CSV line (RFC 4180): fields with a comma, quote or line break are quoted. */
export function csvLine(fields: readonly string[]): string {
  return fields.map((f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',');
}

/**
 * The part of a message around a search match: some words before, more after, with «…» where it
 * was cut. Digits are compared in Latin form, so «۲۰۲» finds «202».
 */
export function searchExcerpt(text: string, query: string, before = 40, after = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const latin = (v: string) => v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const at = latin(flat).toLowerCase().indexOf(latin(query.trim()).toLowerCase());
  if (at < 0) return flat.length > before + after ? `${flat.slice(0, before + after)}…` : flat;
  const start = Math.max(0, at - before);
  const end = Math.min(flat.length, at + query.trim().length + after);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
