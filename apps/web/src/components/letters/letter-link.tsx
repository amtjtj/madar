'use client';

import { Mail } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { cn } from '@madar/ui';

import { useLetterUnread } from '@/hooks/letters';

/** Phones: the tab bar is full, so letters sit next to the bell in the header. */
export function LetterLink({ className }: { className?: string }) {
  const { data: unread = 0 } = useLetterUnread();
  return (
    <Link
      href="/letters"
      aria-label={
        unread > 0 ? t('letters.navUnread', { count: formatNumber(unread) }) : t('letters.nav')
      }
      className={cn(
        'relative grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-5',
        className,
      )}
    >
      <Mail aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -end-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold text-on-primary ring-2 ring-canvas"
        >
          {unread > 9 ? `${formatNumber(9)}+` : formatNumber(unread)}
        </span>
      )}
    </Link>
  );
}
