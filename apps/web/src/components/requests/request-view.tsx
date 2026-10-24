'use client';

import { ArrowRight, Check, X } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatJalaliDate,
  formatNumber,
  formatTime,
  toPersianDigits,
  type ExpenseData,
  type GeneralData,
  type LeaveData,
  type RequestDetail,
} from '@madar/shared';
import {
  AmountText,
  ApprovalTimeline,
  Button,
  Card,
  CardContent,
  EmptyState,
  Modal,
  RequestKindBadge,
  RequestStatusBadge,
  Skeleton,
  TextAreaField,
  useToast,
} from '@madar/ui';

import { AttachmentList } from '@/components/work/attachments';
import { useCancelRequest, useDecideRequest, useRequest } from '@/hooks/requests';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';
import { requestTitle } from '@/lib/requests';

/** One request: what was asked, who decides, and the approve / reject / cancel buttons. */
export function RequestView({ id }: { id: string }) {
  const { data: request, isPending, isError } = useRequest(id);
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;

  const back = (
    <Link
      href="/requests"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
    >
      <ArrowRight aria-hidden />
      {t('requests.title')}
    </Link>
  );
  if (isError) {
    return (
      <>
        {back}
        <Card>
          <EmptyState
            title={t('requests.detail.notFound')}
            description={t('requests.detail.notFoundHint')}
          />
        </Card>
      </>
    );
  }
  if (isPending || !request) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  const stamp = (iso: string) =>
    `${formatJalaliDate(new Date(iso), 'medium', timeZone)}، ${formatTime(new Date(iso), timeZone)}`;
  const current = request.steps.findIndex((s) => s.decision === null);

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RequestKindBadge kind={request.kind} />
          <RequestStatusBadge status={request.status} />
        </div>
        <h1 className="text-2xl font-black text-ink md:text-3xl">{requestTitle(request)}</h1>
        <p className="text-sm text-ink-muted">
          {t('requests.detail.by', {
            name: request.requester.displayName,
            date: stamp(request.createdAt),
          })}
        </p>
      </div>
      <div className="grid gap-6 pb-20 md:pb-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <Facts request={request} />
              {request.attachments.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="font-bold text-ink">{t('requests.detail.files')}</h2>
                  <AttachmentList attachments={request.attachments} />
                </section>
              )}
            </CardContent>
          </Card>
          {request.can.decide && <Decide id={request.id} />}
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-4">
              <ApprovalTimeline
                steps={request.steps.map((s, i) => ({
                  approver: s.approver.displayName,
                  decision: s.decision,
                  comment: s.comment,
                  when: s.decidedAt ? stamp(s.decidedAt) : null,
                  decidedBy: s.decidedBy?.displayName ?? null,
                  current: request.status === 'pending' && i === current,
                }))}
              />
            </CardContent>
          </Card>
          {request.can.cancel && <CancelRequest id={request.id} />}
        </aside>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function Facts({ request }: { request: RequestDetail }) {
  if (request.kind === 'leave') {
    const data = request.data as LeaveData;
    return (
      <dl className="flex flex-col gap-3">
        <Fact label={t('requests.detail.leave')}>
          {data.kind === 'daily' ? (
            <>
              {t('requests.detail.period', {
                from: formatCalendarDate(data.startsOn, 'full'),
                to: formatCalendarDate(data.endsOn, 'full'),
              })}
              {request.leaveDays !== null && (
                <span className="ms-2 text-sm text-ink-muted">
                  ({t('requests.form.days', { count: formatNumber(request.leaveDays) })})
                </span>
              )}
            </>
          ) : (
            t('requests.detail.hours', {
              date: formatCalendarDate(data.on, 'full'),
              from: toPersianDigits(data.from),
              to: toPersianDigits(data.to),
            })
          )}
        </Fact>
        {data.note && <Fact label={t('requests.detail.note')}>{data.note}</Fact>}
      </dl>
    );
  }
  if (request.kind === 'expense') {
    const data = request.data as ExpenseData;
    return (
      <dl className="flex flex-col gap-3">
        <Fact label={t('requests.detail.amount')}>
          <AmountText toman={data.amountToman} className="text-lg font-bold" />
        </Fact>
        <Fact label={t('requests.detail.category')}>
          {t(`requests.categories.${data.category}`)}
        </Fact>
        <Fact label={t('requests.detail.description')}>
          <span className="whitespace-pre-line">{data.description}</span>
        </Fact>
      </dl>
    );
  }
  return <p className="whitespace-pre-line text-ink">{(request.data as GeneralData).body}</p>;
}

/** «تایید» in one tap; «رد» asks why (a request is never turned down without a reason). */
function Decide({ id }: { id: string }) {
  const decide = useDecideRequest(id);
  const { toast } = useToast();
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const send = (decision: 'approved' | 'rejected', text: string) =>
    decide.mutate(
      { decision, comment: text.trim() },
      {
        onSuccess: () =>
          toast({
            tone: decision === 'approved' ? 'success' : 'info',
            title: t(`requests.detail.${decision}`),
          }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  const reject = (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setRejecting(false);
    send('rejected', reason);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <TextAreaField
          label={t('requests.detail.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={2}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="lg"
            icon={<Check aria-hidden />}
            loading={decide.isPending}
            onClick={() => send('approved', comment)}
          >
            {t('requests.detail.approve')}
          </Button>
          <Modal
            open={rejecting}
            onOpenChange={(open) => {
              setRejecting(open);
              if (open) setReason(comment);
            }}
            title={t('requests.detail.rejectTitle')}
            trigger={
              <Button size="lg" variant="secondary" icon={<X aria-hidden />}>
                {t('requests.detail.reject')}
              </Button>
            }
          >
            <form onSubmit={reject} className="flex flex-col gap-4">
              <TextAreaField
                label={t('requests.detail.rejectReason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={3}
                required
                autoFocus
              />
              <Button type="submit" variant="danger" disabled={!reason.trim()}>
                {t('requests.detail.rejectConfirm')}
              </Button>
            </form>
          </Modal>
        </div>
      </CardContent>
    </Card>
  );
}

function CancelRequest({ id }: { id: string }) {
  const cancel = useCancelRequest(id);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('requests.detail.cancel')}
      description={t('requests.detail.cancelConfirm')}
      trigger={
        <Button variant="ghost" className="self-start text-danger-ink">
          {t('requests.detail.cancel')}
        </Button>
      }
    >
      <Button
        variant="danger"
        loading={cancel.isPending}
        onClick={() =>
          cancel.mutate(undefined, {
            onSuccess: () => {
              setOpen(false);
              toast({ tone: 'success', title: t('requests.detail.canceled') });
            },
            onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
          })
        }
      >
        {t('requests.detail.cancel')}
      </Button>
    </Modal>
  );
}
