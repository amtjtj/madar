'use client';

import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  CornerUpLeft,
  Forward,
  ReplyAll,
  Stamp,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { t } from '@madar/i18n';
import { formatJalaliDate, formatNumber, formatTime, type LetterRecipient } from '@madar/shared';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  ConfidentialBadge,
  EmptyState,
  LetterNumber,
  LetterRow,
  LiteText,
  RecipientChip,
  Skeleton,
  UrgencyBadge,
  useToast,
} from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { AttachmentList } from '@/components/work/attachments';
import { useArchiveLetter, useLetter } from '@/hooks/letters';
import { useMe } from '@/hooks/use-me';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { letterDate } from '@/lib/letters';

import { PinToTask } from '@/components/evidence/pin-to-task';

import { ReferDialog } from './refer-dialog';

function People({ label, people }: { label: string; people: LetterRecipient[] }) {
  if (!people.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <dt className="w-16 shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {people.map((p) => (
          <RecipientChip
            key={p.id}
            name={p.displayName}
            read={p.readAt === undefined ? undefined : p.readAt !== null}
          />
        ))}
      </dd>
    </div>
  );
}

/** One letter: header, body, files, referral route, actions and the rest of its thread. */
export function LetterView({ id }: { id: string }) {
  const { data: letter, isPending, isError, error, refetch } = useLetter(id);
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const router = useRouter();
  const archive = useArchiveLetter();
  const { toast } = useToast();
  // A draft opens in the composer.
  const draftId = letter?.can.edit ? letter.id : null;
  useEffect(() => {
    if (draftId) router.replace(`/letters/new?draft=${draftId}`);
  }, [draftId, router]);

  const back = (
    <Link
      href="/letters"
      className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
    >
      <ArrowRight aria-hidden />
      {t('letters.back')}
    </Link>
  );

  if (isPending) {
    return (
      <div aria-busy>
        {back}
        <Skeleton className="mb-3 h-10 w-2/3 rounded-lg" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (isError || !letter) {
    return (
      <div>
        {back}
        {error instanceof ApiClientError && error.status === 404 ? (
          <EmptyState title={t('letters.notFound')} />
        ) : (
          <EmptyState
            title={errorMessage(error)}
            action={<Button onClick={() => void refetch()}>{t('letters.retry')}</Button>}
          />
        )}
      </div>
    );
  }
  if (draftId) return null;

  const sentAt = letter.sentAt ? new Date(letter.sentAt) : null;
  const direct = letter.recipients.filter((r) => r.kind === 'to');
  const copies = letter.recipients.filter((r) => r.kind === 'cc');
  const referrals = letter.recipients.filter((r) => r.kind === 'referral');

  const toggleArchive = () =>
    archive.mutate(
      { id: letter.id, archived: !letter.archived },
      {
        onSuccess: () =>
          toast({
            tone: 'success',
            title: t(letter.archived ? 'letters.unarchived' : 'letters.archived'),
          }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );

  return (
    <div className="pb-20 md:pb-0">
      {back}
      <article className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-black text-ink md:text-3xl">{letter.subject}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {letter.number && (
              <span>
                {t('letters.number')}: <LetterNumber value={letter.number} className="text-ink" />
              </span>
            )}
            {sentAt && (
              <span>
                {t('letters.sentAt', {
                  date: formatJalaliDate(sentAt, 'long', timeZone),
                  time: formatTime(sentAt, timeZone),
                })}
              </span>
            )}
            <UrgencyBadge urgency={letter.urgency} />
            {letter.confidential && <ConfidentialBadge />}
          </div>
        </header>

        <Card>
          <CardContent className="flex flex-col gap-4 pt-5">
            <dl className="flex flex-col gap-2 border-b border-line pb-4">
              <div className="flex items-center gap-1.5">
                <dt className="w-16 shrink-0 text-sm text-ink-muted">{t('letters.from')}</dt>
                <dd className="flex items-center gap-2 font-semibold text-ink">
                  <Avatar name={letter.sender.displayName} size="xs" />
                  {letter.sender.displayName}
                </dd>
              </div>
              <People label={t('letters.to')} people={direct} />
              <People label={t('letters.cc')} people={copies} />
            </dl>
            <LiteText text={letter.body.text} />
            {letter.attachments.length > 0 && (
              <section aria-label={t('letters.attachments')} className="border-t border-line pt-4">
                <h2 className="mb-2 text-sm font-bold text-ink">{t('letters.attachments')}</h2>
                <AttachmentList attachments={letter.attachments} />
              </section>
            )}
          </CardContent>
        </Card>

        {referrals.length > 0 && (
          <section
            aria-label={t('letters.referrals')}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-ink [&_svg]:size-4">
              <Forward aria-hidden />
              {t('letters.referrals')}
            </h2>
            <ul className="flex flex-col gap-3">
              {referrals.map((r) => (
                <li key={r.id} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    {t('letters.referralLine', {
                      from: r.referredBy?.displayName ?? '',
                      to: r.displayName,
                    })}
                    {r.readAt !== undefined && (
                      <span
                        className={
                          r.readAt ? 'text-xs text-success-ink' : 'text-xs text-ink-subtle'
                        }
                      >
                        {t(r.readAt ? 'ui.letter.read' : 'ui.letter.notRead')}
                      </span>
                    )}
                    {r.referredAt && (
                      <span className="text-xs text-ink-subtle">
                        {letterDate(r.referredAt, timeZone)}
                      </span>
                    )}
                  </span>
                  {r.referralNote && (
                    <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
                      {r.referralNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div
          role="group"
          aria-label={t('letters.actions')}
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-surface/95 px-3 py-2.5 backdrop-blur md:static md:z-auto md:flex-wrap md:border-0 md:bg-transparent md:p-0 print:hidden [&>*]:max-md:h-10 [&>*]:max-md:px-3 [&>*]:max-md:text-sm"
        >
          {letter.can.reply && (
            <Button
              icon={<CornerUpLeft aria-hidden />}
              onClick={() => router.push(`/letters/new?replyTo=${letter.id}`)}
            >
              {t('letters.reply')}
            </Button>
          )}
          {letter.can.reply && (
            <Button
              variant="secondary"
              icon={<ReplyAll aria-hidden />}
              onClick={() => router.push(`/letters/new?replyTo=${letter.id}&all=1`)}
            >
              {t('letters.replyAll')}
            </Button>
          )}
          {letter.can.refer && <ReferDialog letter={letter} />}
          {letter.can.pin && <PinToTask letter={letter} />}
          {sentAt && (
            <Button
              variant="ghost"
              icon={letter.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              onClick={toggleArchive}
            >
              <span className="sr-only md:not-sr-only">
                {t(letter.archived ? 'letters.unarchive' : 'letters.archive')}
              </span>
            </Button>
          )}
        </div>

        {letter.pinnedElsewhere > 0 && (
          <p className="flex items-center gap-1.5 rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink [&_svg]:size-4">
            <Stamp aria-hidden />
            {t('evidence.pinnedElsewhere', { count: formatNumber(letter.pinnedElsewhere) })}
          </p>
        )}
        {letter.pinnedTo.length > 0 && (
          <section aria-label={t('evidence.pinnedTo')} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 font-bold text-ink [&_svg]:size-4">
              <Stamp aria-hidden />
              {t('evidence.pinnedTo')}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface p-1">
              {letter.pinnedTo.map((p) => (
                <li key={p.evidenceId}>
                  <Link
                    href={`/tasks/${p.taskId}`}
                    className="flex min-h-11 items-center rounded-xl px-3 py-2 font-medium text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {letter.thread.length > 0 && (
          <section aria-label={t('letters.thread')} className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">{t('letters.thread')}</h2>
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface p-1">
              {letter.thread.map((item) => (
                <li key={item.id}>
                  <LetterRow
                    href={`/letters/${item.id}`}
                    Link={NextLink}
                    person={item.sender.displayName}
                    subject={item.subject}
                    preview={item.preview}
                    number={item.number}
                    date={letterDate(item.sentAt ?? item.updatedAt, timeZone)}
                    urgency={item.urgency}
                    confidential={item.confidential}
                    attachmentCount={item.attachmentCount}
                    unread={!item.read}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
