import { t } from '@madar/i18n';
import { formatCalendarDate, type AskSource } from '@madar/shared';

/** Where a source of an answer opens (ADR 0026): its own page, a channel at that day's first message. */
export function sourceHref(source: AskSource): string {
  switch (source.kind) {
    case 'task':
      return `/tasks/${source.id}`;
    case 'letter':
      return `/letters/${source.id}`;
    case 'meeting':
      return `/meetings/${source.id}`;
    case 'channel':
      return source.messageId ? `/chat/${source.id}?m=${source.messageId}` : `/chat/${source.id}`;
  }
}

/** A channel source reads «کانال پشتیبانی، ۲ آبان ۱۴۰۵»; the others keep their own title. */
export function sourceTitle(source: AskSource): string {
  return source.kind === 'channel' && source.day
    ? t('ask.channelTitle', { name: source.title, day: formatCalendarDate(source.day, 'medium') })
    : source.title;
}
