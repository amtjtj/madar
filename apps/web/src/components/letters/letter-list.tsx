'use client';

import { Archive, FilePen, Inbox, Search, Send } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { t } from '@madar/i18n';
import { LETTER_FOLDERS, formatNumber, type LetterFolder } from '@madar/shared';
import { Button, EmptyState, LetterRow, Skeleton, TextField, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useLetterUnread, useLetters } from '@/hooks/letters';
import { useMe } from '@/hooks/use-me';
import { letterDate, letterPerson } from '@/lib/letters';

const ICONS: Record<LetterFolder, typeof Inbox> = {
  inbox: Inbox,
  sent: Send,
  drafts: FilePen,
  archive: Archive,
};

/** Folders, search and the list of letters (plan phase-2-step-12a §6). */
export function LetterList() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get('folder') as LetterFolder | null;
  const folder: LetterFolder =
    requested && LETTER_FOLDERS.includes(requested) ? requested : 'inbox';
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useLetters(
    folder,
    search,
  );
  const { data: unread = 0 } = useLetterUnread();
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <nav aria-label={t('letters.foldersLabel')} className="-mx-1 overflow-x-auto px-1">
          <ul className="flex w-max gap-1 rounded-lg bg-sunken p-1">
            {LETTER_FOLDERS.map((f) => {
              const Icon = ICONS[f];
              const active = f === folder;
              return (
                <li key={f}>
                  <NextLink
                    href={f === 'inbox' ? '/letters' : `/letters?folder=${f}`}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold whitespace-nowrap transition-colors [&_svg]:size-4',
                      active ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    <Icon aria-hidden />
                    {t(`letters.folders.${f}`)}
                    {f === 'inbox' && unread > 0 && (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold text-on-primary">
                        {formatNumber(Math.min(unread, 99))}
                      </span>
                    )}
                  </NextLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <TextField
          label={t('letters.search')}
          hideLabel
          type="search"
          placeholder={t('letters.search')}
          icon={<Search aria-hidden />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="md:w-72"
        />
      </div>

      {isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={search ? t('letters.empty.search') : t(`letters.empty.${folder}`)}
          description={search ? undefined : t('letters.emptyHint')}
          action={
            search ? undefined : (
              <Button onClick={() => router.push('/letters/new')}>{t('letters.new')}</Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface p-1">
          {items.map((letter) => (
            <li key={letter.id}>
              <LetterRow
                href={
                  folder === 'drafts' ? `/letters/new?draft=${letter.id}` : `/letters/${letter.id}`
                }
                Link={NextLink}
                person={letterPerson(letter, folder)}
                subject={letter.subject}
                preview={letter.preview}
                number={letter.number}
                date={letterDate(letter.sentAt ?? letter.updatedAt, timeZone)}
                urgency={letter.urgency}
                confidential={letter.confidential}
                attachmentCount={letter.attachmentCount}
                unread={!letter.read}
                tag={
                  letter.receivedAs === 'cc' || letter.receivedAs === 'referral'
                    ? t(`letters.receivedAs.${letter.receivedAs}`)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
      {hasNextPage && (
        <Button
          variant="ghost"
          className="self-center"
          loading={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {t('letters.loadMore')}
        </Button>
      )}
    </div>
  );
}
