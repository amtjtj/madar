'use client';

import { Bold, List, Save, Send, Trash2, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { t } from '@madar/i18n';
import {
  LETTER_URGENCIES,
  LITE_TEXT_MAX,
  toPersianDigits,
  type Attachment,
  type Letter,
  type LetterUrgency,
  type SaveLetterRequest,
  type Upload,
} from '@madar/shared';
import {
  AssistantBadge,
  Button,
  Card,
  CardContent,
  CheckboxField,
  FileTile,
  LiteText,
  Modal,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { FilePicker, PendingList } from '@/components/work/attachments';
import { Segmented } from '@/components/work/task-views';
import { useUploads } from '@/hooks/files';
import {
  useDeleteDraft,
  useDeleteLetterFile,
  useLetter,
  useSaveDraft,
  useSendLetter,
} from '@/hooks/letters';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';
import { dropReplyDraft, peekReplyDraft } from '@/lib/assistant-drafts';
import { applyMark, joinNames, replyRecipients, replySubject } from '@/lib/letters';

import { RecipientPicker, type Person } from './recipient-picker';

interface Initial {
  draftId?: string;
  replyTo?: Letter;
  to: Person[];
  cc: Person[];
  subject: string;
  urgency: LetterUrgency;
  confidential: boolean;
  text: string;
  attachments: Attachment[];
  /** The body was drafted by the assistant on the letter page (plan phase-3-step-16c). */
  assisted?: boolean;
}

function fromDraft(letter: Letter): Initial {
  const person = (kind: 'to' | 'cc') =>
    letter.recipients
      .filter((r) => r.kind === kind)
      .map(({ id, displayName }) => ({ id, displayName }));
  return {
    draftId: letter.id,
    to: person('to'),
    cc: person('cc'),
    subject: letter.subject,
    urgency: letter.urgency,
    confidential: letter.confidential,
    text: letter.body.text,
    attachments: letter.attachments,
  };
}

function fromReply(
  letter: Letter,
  all: boolean,
  me: string | undefined,
  drafted: string | null,
): Initial {
  return {
    replyTo: letter,
    ...replyRecipients(letter, all, me),
    subject: replySubject(letter.subject),
    urgency: 'normal',
    confidential: letter.confidential,
    text: drafted ?? '',
    attachments: [],
    assisted: drafted !== null,
  };
}

/** `/letters/new`: a new letter, a reply (`?replyTo=…&all=1`) or a saved draft (`?draft=…`). */
export function Compose() {
  const params = useSearchParams();
  const draftParam = params.get('draft') ?? undefined;
  const replyParam = params.get('replyTo') ?? undefined;
  const all = params.get('all') === '1';
  const { data: me } = useMe();
  const draft = useLetter(draftParam);
  const reply = useLetter(draftParam ? undefined : replyParam);
  // Read once on arrival (the strict-mode double render reads the same value), cleared after.
  const [drafted] = useState(() => (replyParam && !draftParam ? peekReplyDraft(replyParam) : null));
  useEffect(() => {
    if (replyParam && drafted !== null) dropReplyDraft(replyParam);
  }, [replyParam, drafted]);
  const memberId = me?.member?.id;
  const router = useRouter();
  // `?draft=` of a letter that was sent meanwhile: show the letter instead of a blank form.
  const sentId = draft.data && !draft.data.can.edit ? draft.data.id : null;
  useEffect(() => {
    if (sentId) router.replace(`/letters/${sentId}`);
  }, [sentId, router]);

  const loading = (draftParam && draft.isPending) || (replyParam && !draftParam && reply.isPending);
  if (loading || !me || sentId) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <Skeleton className="h-10 w-1/2 rounded-lg" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  const initial: Initial =
    draft.data && draft.data.can.edit
      ? fromDraft(draft.data)
      : reply.data
        ? fromReply(reply.data, all, memberId, drafted)
        : {
            to: [],
            cc: [],
            subject: '',
            urgency: 'normal',
            confidential: false,
            text: '',
            attachments: [],
          };
  return <ComposeForm initial={initial} memberId={memberId} />;
}

function ComposeForm({ initial, memberId }: { initial: Initial; memberId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [draftId, setDraftId] = useState(initial.draftId);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [urgency, setUrgency] = useState<LetterUrgency>(initial.urgency);
  const [confidential, setConfidential] = useState(initial.confidential);
  const [text, setText] = useState(initial.text);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [attached, setAttached] = useState<Attachment[]>(initial.attachments);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const files = useUploads();
  const save = useSaveDraft();
  const send = useSendLetter();
  const remove = useDeleteDraft();
  const removeFile = useDeleteLetterFile(draftId);
  const busy = save.isPending || send.isPending;
  // Kept from the first render: after the first save the address names the draft instead.
  const [replyTo] = useState(initial.replyTo);

  const body = (): SaveLetterRequest => ({
    subject: subject.trim(),
    body: { format: 'lite', text },
    to: to.map((p) => p.id),
    cc: cc.map((p) => p.id),
    urgency,
    confidential,
    uploadIds: uploads.map((u) => u.id),
    replyToId: replyTo?.id ?? null,
  });

  /** Saves the draft; files picked since the last save are attached to it. */
  const persist = async (): Promise<Letter> => {
    const letter = await save.mutateAsync({ id: draftId, body: body() });
    setDraftId(letter.id);
    setUploads([]);
    setAttached(letter.attachments);
    if (!draftId) router.replace(`/letters/new?draft=${letter.id}`, { scroll: false });
    return letter;
  };

  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  const mark = (kind: 'bold' | 'list') => {
    const el = textarea.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = applyMark(text, start, end, kind);
    setText(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.start, next.end);
    });
  };

  const trySend = () => {
    if (files.pending.length) return setProblem(t('letters.compose.uploading'));
    if (!to.length) return setProblem(t('letters.compose.needsRecipient'));
    if (!subject.trim()) return setProblem(t('letters.compose.needsSubject'));
    setProblem('');
    setConfirming(true);
  };

  const title = draftId
    ? t('letters.compose.editTitle')
    : replyTo
      ? t('letters.compose.replyTitle')
      : t('letters.compose.title');

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          replyTo ? t('letters.compose.inReplyTo', { subject: replyTo.subject }) : undefined
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <RecipientPicker
            label={t('letters.compose.to')}
            value={to}
            onChange={(next) => {
              setTo(next);
              setProblem('');
            }}
            exclude={[...(memberId ? [memberId] : []), ...cc.map((p) => p.id)]}
          />
          <RecipientPicker
            label={t('letters.compose.cc')}
            value={cc}
            onChange={setCc}
            exclude={[...(memberId ? [memberId] : []), ...to.map((p) => p.id)]}
          />
          <TextField
            label={t('letters.compose.subject')}
            value={subject}
            maxLength={200}
            onChange={(e) => {
              setSubject(e.target.value);
              setProblem('');
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <SelectField
              label={t('letters.compose.urgency')}
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as LetterUrgency)}
              options={LETTER_URGENCIES.map((u) => ({
                value: u,
                label: t(`letters.compose.urgencies.${u}`),
              }))}
              className="sm:w-48"
            />
            <CheckboxField
              label={t('letters.compose.confidential')}
              description={t('letters.compose.confidentialHint')}
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="sm:flex-1"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {t('letters.compose.body')}
                {initial.assisted && <AssistantBadge />}
              </span>
              <div className="flex items-center gap-2">
                {mode === 'write' && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => mark('bold')}
                      aria-label={t('letters.compose.bold')}
                      title={t('letters.compose.bold')}
                      className="grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-4"
                    >
                      <Bold aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => mark('list')}
                      aria-label={t('letters.compose.list')}
                      title={t('letters.compose.list')}
                      className="grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-4"
                    >
                      <List aria-hidden />
                    </button>
                  </div>
                )}
                <Segmented
                  label={t('letters.compose.body')}
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'write', label: t('letters.compose.edit') },
                    { value: 'preview', label: t('letters.compose.preview') },
                  ]}
                />
              </div>
            </div>
            {mode === 'write' ? (
              <TextAreaField
                ref={textarea}
                label={t('letters.compose.body')}
                hideLabel
                hint={t('letters.compose.bodyHint')}
                placeholder={t('letters.compose.bodyPlaceholder')}
                rows={10}
                maxLength={LITE_TEXT_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              <div className="min-h-60 rounded-xl border border-line bg-canvas p-4">
                {text.trim() ? (
                  <LiteText text={text} />
                ) : (
                  <p className="text-ink-subtle">{t('letters.compose.emptyPreview')}</p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {[...attached, ...uploads].length > 0 && (
              <ul className="flex flex-col gap-2">
                {attached.map((a) => (
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
                            onClick={() => {
                              setAttached((list) => list.filter((x) => x.id !== a.id));
                              removeFile.mutate(a.id, {
                                onError: (error) => {
                                  setAttached((list) => [...list, a]);
                                  onError(error);
                                },
                              });
                            }}
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
            )}
            <PendingList pending={files.pending} onCancel={files.cancel} />
            <div>
              <FilePicker
                label={t('letters.compose.attach')}
                onFiles={(picked) =>
                  void files.upload(picked).then((done) => setUploads((list) => [...list, ...done]))
                }
              />
            </div>
          </div>

          {problem && (
            <p role="alert" className="text-sm font-semibold text-danger-ink">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button icon={<Send aria-hidden />} onClick={trySend} disabled={busy}>
              {t('letters.compose.send')}
            </Button>
            <Button
              variant="secondary"
              icon={<Save aria-hidden />}
              loading={save.isPending && !confirming}
              disabled={busy || files.pending.length > 0}
              onClick={() =>
                void persist()
                  .then(() => toast({ tone: 'success', title: t('letters.compose.draftSaved') }))
                  .catch(onError)
              }
            >
              {t('letters.compose.saveDraft')}
            </Button>
            {draftId && (
              <Button
                variant="ghost"
                className="ms-auto text-danger-ink"
                icon={<Trash2 aria-hidden />}
                onClick={() => setDeleting(true)}
              >
                {t('letters.compose.deleteDraft')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={t('letters.compose.confirmTitle')}
        description={t('letters.compose.confirmBody')}
      >
        <div className="flex flex-col gap-1 rounded-xl bg-sunken p-3 text-sm text-ink">
          <p className="font-bold">{subject.trim()}</p>
          <p>
            {t('letters.compose.confirmTo', { names: joinNames(to.map((p) => p.displayName)) })}
          </p>
          {cc.length > 0 && (
            <p>
              {t('letters.compose.confirmCc', { names: joinNames(cc.map((p) => p.displayName)) })}
            </p>
          )}
          <p>
            {t('letters.compose.confirmUrgency', {
              urgency: t(`letters.compose.urgencies.${urgency}`),
            })}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            className="flex-1"
            icon={<Send aria-hidden />}
            loading={busy}
            onClick={() =>
              void persist()
                .then((letter) => send.mutateAsync(letter.id))
                .then((letter) => {
                  toast({
                    tone: 'success',
                    title: t('letters.compose.sent', {
                      number: toPersianDigits(letter.number ?? ''),
                    }),
                  });
                  router.replace(`/letters/${letter.id}`);
                })
                .catch((error: unknown) => {
                  setConfirming(false);
                  onError(error);
                })
            }
          >
            {t('letters.compose.send')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('letters.compose.cancel')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title={t('letters.compose.deleteDraftTitle')}
        description={t('letters.compose.deleteDraftBody')}
      >
        <div className="flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            loading={remove.isPending}
            onClick={() =>
              draftId &&
              remove.mutate(draftId, {
                onSuccess: () => {
                  toast({ tone: 'success', title: t('letters.compose.draftDeleted') });
                  router.replace('/letters?folder=drafts');
                },
                onError,
              })
            }
          >
            {t('letters.compose.deleteDraft')}
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            {t('letters.compose.cancel')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
