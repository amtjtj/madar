'use client';

import { MessageCircleQuestion } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { cn } from '@madar/ui';

import { useAiStatus } from '@/hooks/ai';

/** Phones: «از مدار بپرس» from the today page (desktop has it in the sidebar), only while it is on. */
export function AskLink({ className }: { className?: string }) {
  const { data } = useAiStatus();
  if (!data?.available || !data.enabled) return null;
  return (
    <Link
      href="/ask"
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-4 [&_svg]:text-accent-ink',
        className,
      )}
    >
      <MessageCircleQuestion aria-hidden />
      {t('ask.nav')}
    </Link>
  );
}
