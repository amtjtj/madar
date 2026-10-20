'use client';

import { Search, Stamp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, formatRelativeTime, type Evidence, type LetterSummary } from '@madar/shared';
import {
  AudienceNote,
  Button,
  ConfidentialBadge,
  EvidenceCard,
  LetterNumber,
  LiteText,
  Modal,
  Skeleton,
  TextField,
  UrgencyBadge,
  useToast,
} from '@madar/ui';

import { AttachmentList } from '@/components/work/attachments';
import {
  useEvidenceAudience,
  useEvidenceCandidates,
  useEvidenceDetail,
  usePinEvidence,
  useTaskEvidence,
  useUnpinEvidence,
} from '@/hooks/evidence';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';
import { letterDate } from '@/lib/letters';

/** «شاهدهای کار» on the task page (plan phase-2-step-12b §6). */
export function TaskEvidence({ taskId, canPin }: { taskId: string; canPin: boolean }) {
  const { data: items, isPending } = useTaskEvidence(taskId);
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Evidence | null>(null);
  const unpin = useUnpinEvidence(taskId);
  const { toast } = useToast();

  return (
    <section aria-labelledby={`evidence-${taskId}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          id={`evidence-${taskId}`}
          className="flex items-center gap-1.5 font-bold text-ink [&_svg]:size-4"
        >
          <Stamp aria-hidden />
          {t('evidence.title')}
        </h2>
        {canPin && <PinLetterDialog taskId={taskId} />}
      </div>
      {isPending ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : !items?.length ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
          {t(canPin ? 'evidence.empty' : 'evidence.emptyViewer')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((e) => (
            <li key={e.id}>
              <EvidenceCard
                summary={e.summary}
                date={e.summary ? letterDate(e.summary.date, timeZone) : undefined}
                meta={t('evidence.pinnedBy', {
                  name: e.pinnedBy.displayName,
                  time: formatRelativeTime(new Date(e.pinnedAt)),
                })}
                onOpen={e.summary ? () => setViewing(e.id) : undefined}
                onUnpin={e.can.unpin ? () => setRemoving(e) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      <EvidenceViewer taskId={taskId} id={viewing} onClose={() => setViewing(null)} />
      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('evidence.unpinTitle')}
        description={t('evidence.unpinBody')}
      >
        <div className="flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              if (!removing) return;
              unpin.mutate(removing.id, {
                onSuccess: () => toast({ tone: 'success', title: t('evidence.unpinned') }),
                onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
              });
              setRemoving(null);
            }}
          >
            {t('evidence.unpinConfirm')}
          </Button>
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            {t('evidence.cancel')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

/** The pinned letter, read-only: header, body and files; never its thread. */
function EvidenceViewer({
  taskId,
  id,
  onClose,
}: {
  taskId: string;
  id: string | null;
  onClose: () => void;
}) {
  const { data, isPending, isError, error } = useEvidenceDetail(taskId, id);
  const { data: me } = useMe();
  const summary = data?.summary;
  return (
    <Modal
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      title={summary?.subject ?? t('evidence.title')}
      className="sm:max-w-2xl"
    >
      {isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : isError || !data || !summary ? (
        <p className="text-sm text-ink-muted">
          {isError ? errorMessage(error) : t('evidence.unavailable')}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info-ink">
            {t('evidence.viewNote')}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {summary.number && <LetterNumber value={summary.number} className="text-ink" />}
            <span>{letterDate(summary.date, me?.tenant?.timezone)}</span>
            <UrgencyBadge urgency={summary.urgency} />
          </div>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-ink-muted">{t('letters.from')}</dt>
              <dd className="text-ink">{summary.sender.displayName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-ink-muted">{t('letters.to')}</dt>
              <dd className="text-ink">
                {summary.to.map((p) => p.displayName).join(t('ui.listSeparator'))}
              </dd>
            </div>
            {data.cc.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-muted">{t('letters.cc')}</dt>
                <dd className="text-ink">
                  {data.cc.map((p) => p.displayName).join(t('ui.listSeparator'))}
                </dd>
              </div>
            )}
          </dl>
          <div className="border-t border-line pt-3">
            <LiteText text={data.body.text} />
          </div>
          {data.attachments.length > 0 && (
            <section aria-label={t('letters.attachments')} className="border-t border-line pt-3">
              <AttachmentList attachments={data.attachments} />
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

/** «سنجاق نامه»: pick one of my letters, then see who will see it, then pin. */
function PinLetterDialog({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<LetterSummary | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data: letters, isPending } = useEvidenceCandidates(taskId, search, open);
  const { data: me } = useMe();
  const pin = usePinEvidence();
  const { toast } = useToast();
  const close = () => {
    setOpen(false);
    setChosen(null);
    setQuery('');
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title={t('evidence.pinTitle')}
      trigger={
        <Button size="sm" variant="secondary" icon={<Stamp aria-hidden />}>
          {t('evidence.pinLetter')}
        </Button>
      }
    >
      {chosen ? (
        <ConfirmPin
          taskId={taskId}
          subject={chosen.subject}
          busy={pin.isPending}
          onBack={() => setChosen(null)}
          onPin={() =>
            pin.mutate(
              { taskId, letterId: chosen.id },
              {
                onSuccess: () => {
                  toast({ tone: 'success', title: t('evidence.pinned') });
                  close();
                },
                onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
              },
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <TextField
            label={t('evidence.search')}
            hideLabel
            type="search"
            placeholder={t('evidence.search')}
            icon={<Search aria-hidden />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p role="status" className="sr-only">
            {t('evidence.results', { count: formatNumber(letters?.length ?? 0) })}
          </p>
          {isPending ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : !letters?.length ? (
            <p className="py-2 text-sm text-ink-muted">{t('evidence.noCandidates')}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {letters.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    aria-label={t('evidence.choose', { subject: l.subject })}
                    onClick={() => setChosen(l)}
                    className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-start hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="truncate font-medium text-ink">{l.subject}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                      {l.number && <LetterNumber value={l.number} />}
                      <span>{l.sender.displayName}</span>
                      {l.sentAt && <span>{letterDate(l.sentAt, me?.tenant?.timezone)}</span>}
                      <UrgencyBadge urgency={l.urgency} />
                      {l.confidential && <ConfidentialBadge />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/** The second step of both pin dialogs: who will see it, then «سنجاق». */
export function ConfirmPin({
  taskId,
  subject,
  busy,
  onBack,
  onPin,
}: {
  taskId: string;
  subject: string;
  busy: boolean;
  onBack: () => void;
  onPin: () => void;
}) {
  const { data: audience, isPending } = useEvidenceAudience(taskId);
  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold text-ink">{subject}</p>
      {isPending || !audience ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        <AudienceNote audience={audience} />
      )}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          icon={<Stamp aria-hidden />}
          loading={busy}
          disabled={!audience}
          onClick={onPin}
        >
          {t('evidence.pin')}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('evidence.back')}
        </Button>
      </div>
    </div>
  );
}
