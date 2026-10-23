'use client';

import {
  ArrowRight,
  Ban,
  CalendarX,
  CheckSquare,
  ExternalLink,
  FileText,
  MapPin,
  MoreVertical,
  Pencil,
  Plus,
  Repeat,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  DECISION_TEXT_MAX,
  LITE_TEXT_MAX,
  calendarDateIn,
  formatJalaliDate,
  formatNumber,
  taskTitleFromDecision,
  type Meeting,
  type MeetingDecision,
  type Upload,
} from '@madar/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  DatePicker,
  DecisionItem,
  EmptyState,
  FileTile,
  LiteText,
  Menu,
  MeetingTypeBadge,
  Modal,
  RecipientChip,
  RsvpButtons,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  useToast,
} from '@madar/ui';

import { PinToTaskDialog } from '@/components/evidence/pin-to-task';
import { NextLink } from '@/components/next-link';
import { RecipientPicker, type Person } from '@/components/letters/recipient-picker';
import { AttachmentList, FilePicker, PendingList } from '@/components/work/attachments';
import { useUploads } from '@/hooks/files';
import { meetingKeys } from '@/hooks/keys';
import { useKeyResultOptions } from '@/hooks/goals';
import {
  useAddDecision,
  useCancelMeeting,
  useCancelSeries,
  useConvertDecision,
  useDeleteMinutesFile,
  useMeeting,
  useMinutesTasks,
  useRemoveDecision,
  useRespond,
  useSaveMinutes,
} from '@/hooks/meetings';
import { useMe } from '@/hooks/use-me';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { isLive, meetingTime, seriesText } from '@/lib/meetings';

import { LiteField } from './lite-field';

/** One meeting: header, people, agenda, minutes and decisions (plan phase-2-step-13a §6). */
export function MeetingView({ id }: { id: string }) {
  const { data: meeting, isPending, isError, error, refetch } = useMeeting(id);
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const router = useRouter();
  const cancel = useCancelMeeting();
  const { toast } = useToast();
  const [canceling, setCanceling] = useState(false);
  const [cancelingSeries, setCancelingSeries] = useState(false);
  const cancelSeries = useCancelSeries();
  const respond = useRespond(id, me?.member?.id);

  const back = (
    <Link
      href="/meetings"
      className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
    >
      <ArrowRight aria-hidden />
      {t('meetings.back')}
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
  if (isError || !meeting) {
    return (
      <div>
        {back}
        {error instanceof ApiClientError && error.status === 404 ? (
          <EmptyState title={t('meetings.notFound')} />
        ) : (
          <EmptyState
            title={errorMessage(error)}
            action={<Button onClick={() => void refetch()}>{t('meetings.retry')}</Button>}
          />
        )}
      </div>
    );
  }
  const canceled = meeting.canceledAt !== null;

  return (
    <div className="pb-20 md:pb-0">
      {back}
      <article className="flex flex-col gap-4">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h1
              className={
                canceled
                  ? 'text-2xl font-black text-ink-subtle line-through md:text-3xl'
                  : 'text-2xl font-black text-ink md:text-3xl'
              }
            >
              {meeting.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <span>{meetingTime(meeting, timeZone, true)}</span>
              <MeetingTypeBadge type={meeting.type} />
              {isLive(meeting) && !canceled && (
                <Badge tone="success" dot>
                  {t('meetings.todayCard.now')}
                </Badge>
              )}
            </div>
            {meeting.series && (
              <p className="flex items-center gap-1.5 text-sm text-ink-muted [&_svg]:size-4">
                <Repeat aria-hidden />
                {meeting.series.canceled
                  ? t('meetings.seriesCanceled')
                  : seriesText(meeting.series)}
              </p>
            )}
          </div>
          {meeting.can.edit && (
            <Menu
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('meetings.actions')}
                  icon={<MoreVertical aria-hidden />}
                />
              }
              items={[
                {
                  key: 'edit',
                  label: t('meetings.edit'),
                  icon: <Pencil aria-hidden />,
                  onSelect: () => router.push(`/meetings/new?edit=${meeting.id}`),
                },
                {
                  key: 'cancel',
                  label: meeting.series ? t('meetings.cancelOne') : t('meetings.cancel'),
                  icon: <Ban aria-hidden />,
                  tone: 'danger',
                  onSelect: () => setCanceling(true),
                },
                ...(meeting.series && !meeting.series.canceled
                  ? [
                      {
                        key: 'cancel-series',
                        label: t('meetings.cancelSeries'),
                        icon: <CalendarX aria-hidden />,
                        tone: 'danger' as const,
                        onSelect: () => setCancelingSeries(true),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </header>

        {canceled && (
          <p
            role="status"
            className="rounded-xl bg-danger-soft p-3 text-sm font-semibold text-danger-ink"
          >
            {t('meetings.canceledBanner')}
          </p>
        )}

        <Card>
          <CardContent className="flex flex-col gap-3 pt-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink-muted">{t('meetings.organizer')}</span>
              <span className="inline-flex items-center gap-1.5 text-ink">
                <Avatar name={meeting.organizer.displayName} size="xs" />
                {meeting.organizer.displayName}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-semibold text-ink-muted">
                {t('meetings.people')} ({formatNumber(meeting.participants.length)})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {meeting.participants.map((p) => (
                  <RecipientChip
                    key={p.id}
                    name={p.displayName}
                    note={t(`meetings.response.${p.response}`)}
                  />
                ))}
              </div>
              {meeting.participants.length > 1 && (
                <p className="text-xs text-ink-subtle">
                  {t('meetings.response.summary', {
                    accepted: formatNumber(meeting.responses.accepted),
                    declined: formatNumber(meeting.responses.declined),
                    pending: formatNumber(meeting.responses.pending),
                  })}
                </p>
              )}
            </div>
            {meeting.location && (
              <p className="flex items-center gap-1.5 text-ink [&_svg]:size-4 [&_svg]:text-ink-subtle">
                <MapPin aria-hidden />
                <span className="sr-only">{t('meetings.location')}</span>
                {meeting.location}
              </p>
            )}
            {meeting.link && (
              <a
                href={meeting.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 self-start font-semibold text-primary-ink hover:underline [&_svg]:size-4"
              >
                <ExternalLink aria-hidden />
                {t('meetings.openLink')}
              </a>
            )}
            {meeting.can.respond && (
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <span className="font-semibold text-ink">{t('meetings.response.label')}</span>
                <RsvpButtons
                  value={meeting.myResponse ?? 'pending'}
                  disabled={respond.isPending}
                  onChange={(response) =>
                    respond.mutate(response, {
                      onSuccess: () =>
                        toast({ tone: 'success', title: t('meetings.response.saved') }),
                      onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
                    })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold text-ink">{t('meetings.agenda')}</h2>
          <Card>
            <CardContent className="pt-4">
              {meeting.agenda.trim() ? (
                <LiteText text={meeting.agenda} />
              ) : (
                <p className="text-ink-subtle">{t('meetings.noAgenda')}</p>
              )}
            </CardContent>
          </Card>
        </section>

        <MinutesSection meeting={meeting} timeZone={timeZone} />
        <DecisionsSection meeting={meeting} today={calendarDateIn(new Date(), timeZone)} />
      </article>

      <Modal
        open={canceling}
        onOpenChange={setCanceling}
        title={t('meetings.cancelTitle')}
        description={t('meetings.cancelBody')}
        footer={
          <>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(meeting.id, {
                  onSuccess: () => {
                    setCanceling(false);
                    toast({ tone: 'success', title: t('meetings.canceledToast') });
                  },
                  onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
                })
              }
            >
              {t('meetings.cancelConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setCanceling(false)}>
              {t('meetings.keep')}
            </Button>
          </>
        }
      />
      <Modal
        open={cancelingSeries}
        onOpenChange={setCancelingSeries}
        title={t('meetings.cancelSeriesTitle')}
        description={t('meetings.cancelSeriesBody')}
        footer={
          <>
            <Button
              variant="danger"
              loading={cancelSeries.isPending}
              onClick={() =>
                cancelSeries.mutate(meeting.series?.id ?? '', {
                  onSuccess: () => {
                    setCancelingSeries(false);
                    toast({ tone: 'success', title: t('meetings.seriesCanceledToast') });
                  },
                  onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
                })
              }
            >
              {t('meetings.cancelSeries')}
            </Button>
            <Button variant="ghost" onClick={() => setCancelingSeries(false)}>
              {t('meetings.keep')}
            </Button>
          </>
        }
      />
    </div>
  );
}

/** «سنجاق به کار» for minutes, and the tasks they already back (plan phase-2-step-13b). */
function MinutesPins({ meeting }: { meeting: Meeting }) {
  const [pinning, setPinning] = useState(false);
  const [listing, setListing] = useState(false);
  const { data, isPending } = useMinutesTasks(meeting.id, listing);
  const client = useQueryClient();
  const count = meeting.minutes?.pinnedCount ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {meeting.can.pin && (
        <PinToTaskDialog
          kind="minutes"
          subjectId={meeting.id}
          open={pinning}
          onOpenChange={setPinning}
          onPinned={() =>
            void client.invalidateQueries({ queryKey: meetingKeys.meeting(meeting.id) })
          }
          trigger={
            <Button variant="secondary" size="sm" icon={<Stamp aria-hidden />}>
              {t('meetings.pinMinutes')}
            </Button>
          }
        />
      )}
      {count > 0 && (
        <Modal
          open={listing}
          onOpenChange={setListing}
          title={t('meetings.pinnedTasksTitle')}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-primary-ink hover:bg-primary-soft [&_svg]:size-3.5"
            >
              <Stamp aria-hidden />
              {t('meetings.pinnedTasks', { count: formatNumber(count) })}
            </button>
          }
        >
          {isPending ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : (
            <div className="flex flex-col gap-2">
              {(data?.visible ?? []).map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 font-medium text-ink hover:bg-sunken [&_svg]:size-4"
                >
                  <CheckSquare aria-hidden className="text-primary-ink" />
                  {task.title}
                </Link>
              ))}
              {(data?.hidden ?? 0) > 0 && (
                <p className="text-sm text-ink-muted">
                  {t('meetings.pinnedHidden', { count: formatNumber(data?.hidden ?? 0) })}
                </p>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function MinutesSection({ meeting, timeZone }: { meeting: Meeting; timeZone?: string }) {
  const minutes = meeting.minutes;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [version, setVersion] = useState(0);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [problem, setProblem] = useState('');
  const [stale, setStale] = useState(false);
  const files = useUploads();
  const save = useSaveMinutes(meeting.id);
  const removeFile = useDeleteMinutesFile(meeting.id);
  const { toast } = useToast();

  const start = () => {
    setText(minutes?.body ?? '');
    setVersion(minutes?.version ?? 0);
    setUploads([]);
    setProblem('');
    setStale(false);
    setEditing(true);
  };
  const submit = () => {
    if (files.pending.length) return setProblem(t('letters.compose.uploading'));
    save.mutate(
      { body: text, version, uploadIds: uploads.map((u) => u.id) },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ tone: 'success', title: t('meetings.minutes.saved') });
        },
        onError: (error) => {
          setProblem(errorMessage(error));
          setStale(error instanceof ApiClientError && error.code === 'minutes_version_conflict');
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{t('meetings.minutes.title')}</h2>
        {meeting.can.record && !editing && (
          <Button variant="secondary" size="sm" icon={<FileText aria-hidden />} onClick={start}>
            {minutes ? t('meetings.minutes.edit') : t('meetings.minutes.write')}
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          {editing ? (
            <>
              <LiteField
                label={t('meetings.minutes.title')}
                placeholder={t('meetings.minutes.placeholder')}
                value={text}
                onChange={setText}
                maxLength={LITE_TEXT_MAX}
                rows={10}
              />
              <ul className="flex flex-col gap-2">
                {(minutes?.attachments ?? []).map((a) => (
                  <li key={a.id}>
                    <FileTile
                      fileName={a.fileName}
                      size={a.size}
                      kind={a.kind}
                      actions={
                        a.can.delete && (
                          <button
                            type="button"
                            aria-label={t('work.files.delete', { name: a.fileName })}
                            onClick={() =>
                              removeFile.mutate(a.id, {
                                onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
                              })
                            }
                            className="grid size-9 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
                          >
                            <Trash2 aria-hidden />
                          </button>
                        )
                      }
                    />
                  </li>
                ))}
                {uploads.map((u) => (
                  <li key={u.id}>
                    <FileTile
                      fileName={u.fileName}
                      size={u.size}
                      kind={u.kind}
                      actions={
                        <button
                          type="button"
                          aria-label={t('work.files.delete', { name: u.fileName })}
                          onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                          className="grid size-9 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
                        >
                          <X aria-hidden />
                        </button>
                      }
                    />
                  </li>
                ))}
              </ul>
              <PendingList pending={files.pending} onCancel={files.cancel} />
              <div>
                <FilePicker
                  label={t('meetings.minutes.attach')}
                  onFiles={(picked) =>
                    void files
                      .upload(picked)
                      .then((done) => setUploads((list) => [...list, ...done]))
                  }
                />
              </div>
              {problem && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 text-sm font-semibold text-danger-ink"
                >
                  {problem}
                  {stale && (
                    <Button variant="ghost" size="sm" onClick={start}>
                      {t('meetings.minutes.reload')}
                    </Button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                <Button loading={save.isPending} onClick={submit}>
                  {t('meetings.minutes.save')}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {t('meetings.minutes.cancel')}
                </Button>
              </div>
            </>
          ) : minutes ? (
            <>
              {minutes.body.trim() && <LiteText text={minutes.body} />}
              {minutes.attachments.length > 0 && (
                <AttachmentList attachments={minutes.attachments} />
              )}
              <p className="text-xs text-ink-subtle">
                {t('meetings.minutes.recordedBy', {
                  name: minutes.recordedBy.displayName,
                  date: formatJalaliDate(new Date(minutes.recordedAt), 'long', timeZone),
                })}
                {minutes.version > 1 &&
                  ` ${t('ui.listSeparator')}${t('meetings.minutes.updatedBy', {
                    name: minutes.updatedBy.displayName,
                    date: formatJalaliDate(new Date(minutes.updatedAt), 'long', timeZone),
                  })}`}
              </p>
              {(meeting.can.pin || minutes.pinnedCount > 0) && <MinutesPins meeting={meeting} />}
            </>
          ) : (
            <p className="text-ink-subtle">{t('meetings.minutes.empty')}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function DecisionsSection({ meeting, today }: { meeting: Meeting; today: string }) {
  const [text, setText] = useState('');
  const [converting, setConverting] = useState<MeetingDecision | null>(null);
  const add = useAddDecision(meeting.id);
  const remove = useRemoveDecision(meeting.id);
  const { toast } = useToast();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    add.mutate(text.trim(), {
      onSuccess: () => setText(''),
      onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold text-ink">{t('meetings.decisions.title')}</h2>
      {meeting.decisions.length === 0 && !meeting.can.record && (
        <p className="text-sm text-ink-subtle">{t('meetings.decisions.empty')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {meeting.decisions.map((d) => (
          <li key={d.id}>
            <DecisionItem
              text={d.text}
              Link={NextLink}
              keyResult={d.keyResult?.title}
              task={
                d.task
                  ? {
                      title: d.task.title,
                      assignee: d.task.assignee?.displayName,
                      href: d.task.visible ? `/tasks/${d.task.id}` : undefined,
                    }
                  : null
              }
              actions={
                !d.task &&
                meeting.can.record && (
                  <>
                    {meeting.can.convert && (
                      <Button variant="secondary" size="sm" onClick={() => setConverting(d)}>
                        {t('meetings.decisions.convert')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('meetings.decisions.delete')}
                      icon={<Trash2 aria-hidden />}
                      onClick={() =>
                        remove.mutate(d.id, {
                          onSuccess: () =>
                            toast({ tone: 'success', title: t('meetings.decisions.deleted') }),
                          onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
                        })
                      }
                    />
                  </>
                )
              }
            />
          </li>
        ))}
      </ul>
      {meeting.can.record && (
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextAreaField
            label={t('meetings.decisions.add')}
            placeholder={t('meetings.decisions.placeholder')}
            rows={2}
            maxLength={DECISION_TEXT_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" icon={<Plus aria-hidden />} loading={add.isPending}>
            {t('meetings.decisions.save')}
          </Button>
        </form>
      )}
      <ConvertDialog
        meeting={meeting}
        decision={converting}
        today={today}
        onClose={() => setConverting(null)}
      />
    </section>
  );
}

/** «تبدیل به کار»: title from the decision, assignee, due date, and a key result in OKR reviews. */
function ConvertDialog({
  meeting,
  decision,
  today,
  onClose,
}: {
  meeting: Meeting;
  decision: MeetingDecision | null;
  today: string;
  onClose: () => void;
}) {
  const convert = useConvertDecision(meeting.id);
  const okr = meeting.type === 'okr_review';
  const { data: keyResults } = useKeyResultOptions(okr && decision !== null);
  const { toast } = useToast();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<Person[]>([]);
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [keyResultId, setKeyResultId] = useState('');
  // A new decision fills the form; set during render, not in an effect.
  const [forId, setForId] = useState<string | null>(null);
  if ((decision?.id ?? null) !== forId) {
    setForId(decision?.id ?? null);
    setTitle(decision ? taskTitleFromDecision(decision.text) : '');
    setAssignee([]);
    setDueOn(null);
    setKeyResultId('');
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!decision || !title.trim()) return;
    convert.mutate(
      {
        decisionId: decision.id,
        body: {
          title: title.trim(),
          assigneeId: assignee[0]?.id ?? null,
          dueOn,
          keyResultId: okr && keyResultId ? keyResultId : null,
        },
      },
      {
        onSuccess: (task) => {
          onClose();
          toast({
            tone: 'success',
            title: t('meetings.convert.done'),
            action: {
              label: t('meetings.convert.open'),
              onClick: () => router.push(`/tasks/${task.id}`),
            },
          });
        },
        onError: (e) => toast({ tone: 'error', title: errorMessage(e) }),
      },
    );
  };

  return (
    <Modal
      open={decision !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('meetings.convert.title')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('meetings.convert.taskTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
        <RecipientPicker
          label={t('meetings.convert.assignee')}
          value={assignee}
          onChange={(next) => setAssignee(next.slice(-1))}
        />
        <DatePicker
          label={t('meetings.convert.due')}
          value={dueOn}
          onChange={setDueOn}
          today={today}
        />
        {okr && (
          <SelectField
            label={t('meetings.convert.keyResult')}
            value={keyResultId}
            onChange={(e) => setKeyResultId(e.target.value)}
            options={[
              { value: '', label: t('meetings.convert.noKeyResult') },
              ...(keyResults ?? []).map((o) => ({
                value: o.id,
                label: `${o.title} (${o.goal.title})`,
              })),
            ]}
          />
        )}
        <div className="flex gap-3">
          <Button type="submit" loading={convert.isPending} className="flex-1">
            {t('meetings.convert.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('meetings.convert.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
