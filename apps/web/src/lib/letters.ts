import { t } from '@madar/i18n';
import { formatJalaliDate, formatTime, type LetterSummary } from '@madar/shared';

/** «۲۸ مهر» for this year's letters, «۱۴۰۴/۱۲/۰۳» for older ones, the time for today's. */
export function letterDate(iso: string, timeZone?: string, now = new Date()): string {
  const date = new Date(iso);
  const day = formatJalaliDate(date, 'short', timeZone);
  if (day === formatJalaliDate(now, 'short', timeZone)) return formatTime(date, timeZone);
  return day.slice(0, 4) === formatJalaliDate(now, 'short', timeZone).slice(0, 4)
    ? formatJalaliDate(date, 'medium', timeZone)
    : day;
}

export function joinNames(names: string[]): string {
  return names.join(t('ui.listSeparator'));
}

/** Who the row names: the sender, or the recipients in «sent» and «drafts». */
export function letterPerson(letter: LetterSummary, folder: string): string {
  if (folder === 'sent' || folder === 'drafts') {
    return letter.to.length
      ? t('letters.toPeople', { names: joinNames(letter.to.map((p) => p.displayName)) })
      : t('letters.draftLabel');
  }
  return letter.sender.displayName;
}

export function replySubject(subject: string): string {
  const prefix = t('letters.replyPrefix');
  return subject.startsWith(prefix) ? subject : `${prefix}${subject}`;
}

/**
 * Wraps the selection in ** (bold) or starts its lines with «- » (list): the toolbar only types
 * the same marks a person could type (ADR 0020).
 */
export function applyMark(
  text: string,
  start: number,
  end: number,
  mark: 'bold' | 'list',
): { text: string; start: number; end: number } {
  if (mark === 'bold') {
    const selected = text.slice(start, end) || t('letters.compose.bold');
    const next = `${text.slice(0, start)}**${selected}**${text.slice(end)}`;
    return { text: next, start: start + 2, end: start + 2 + selected.length };
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const block = text.slice(lineStart, end);
  const listed = block
    .split('\n')
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
    .join('\n');
  const next = `${text.slice(0, lineStart)}${listed}${text.slice(end)}`;
  return { text: next, start: lineStart, end: lineStart + listed.length };
}
