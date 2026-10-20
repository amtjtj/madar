/**
 * Chat message text (plan phase-2-step-15a, ADR 0022): plain text, never HTML. Links are found
 * here so the web renders them as elements; only http and https become links.
 */
export const MESSAGE_MAX = 4000;
/** Authors may edit or delete a message for this long. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60_000;

export type MessageSegment =
  { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

const LINK = /\bhttps?:\/\/[^\s<>"'«»]+/gi;
/** Punctuation that usually ends a sentence, not a link. */
const TRAILING = /[.,;:!?؟،؛)\]]+$/;

export function messageSegments(body: string): MessageSegment[] {
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
