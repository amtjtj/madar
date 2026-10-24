'use client';

import { FileText, Palmtree, Receipt, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  addDays,
  EXPENSE_CATEGORIES,
  LEAVE_MAX_DAYS,
  formatNumber,
  REQUEST_KINDS,
  toLatinDigits,
  type CreateRequestRequest,
  type ExpenseCategory,
  type LeaveKind,
  type RequestKind,
  type Upload,
} from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  DatePicker,
  FileTile,
  SelectField,
  TextAreaField,
  TextField,
  cn,
  useToast,
} from '@madar/ui';

import { FilePicker, PendingList } from '@/components/work/attachments';
import { useUploads } from '@/hooks/files';
import { useCreateRequest, useRequestRoute } from '@/hooks/requests';
import { useTodayDate } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';
import { quarterTimeOptions } from '@/lib/requests';

const kindIcon = { leave: Palmtree, expense: Receipt, general: FileText } as const;

/** «درخواست تازه» (plan phase-3-step-17b): pick a kind, fill a short form, see who gets it. */
export function RequestForm({ initialKind }: { initialKind: RequestKind | null }) {
  const [kind, setKind] = useState<RequestKind | null>(initialKind);
  return (
    <div className="flex flex-col gap-4 pb-20 md:pb-0">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-bold text-ink">{t('requests.chooseKind')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {REQUEST_KINDS.map((k) => {
            const Icon = kindIcon[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border p-4 text-start transition-colors',
                  kind === k
                    ? 'border-primary-edge bg-primary-soft'
                    : 'border-line bg-surface hover:bg-sunken',
                )}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">
                  <Icon aria-hidden />
                </span>
                <span className="flex flex-col">
                  <span className="font-bold text-ink">{t(`ui.request.kinds.${k}`)}</span>
                  <span className="text-sm text-ink-muted">{t(`requests.kindHints.${k}`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {kind && <KindForm key={kind} kind={kind} />}
    </div>
  );
}

function KindForm({ kind }: { kind: RequestKind }) {
  const router = useRouter();
  const today = useTodayDate();
  const create = useCreateRequest();
  const files = useUploads();
  const { toast } = useToast();
  const [uploads, setUploads] = useState<Upload[]>([]);
  // Leave.
  const [leaveKind, setLeaveKind] = useState<LeaveKind>('daily');
  const [startsOn, setStartsOn] = useState<string | null>(null);
  const [endsOn, setEndsOn] = useState<string | null>(null);
  const [fromTime, setFromTime] = useState('09:00');
  const [toTime, setToTime] = useState('11:00');
  const [note, setNote] = useState('');
  // Expense.
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('equipment');
  const [description, setDescription] = useState('');
  // General.
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const amountToman = Number(toLatinDigits(amount).replace(/[^\d]/g, '')) || null;
  const amountTooSmall = amountToman !== null && amountToman < 1_000;
  // The route follows the amount once typing pauses, not on every key.
  const [routeAmount, setRouteAmount] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setRouteAmount(amountToman), 400);
    return () => clearTimeout(timer);
  }, [amountToman]);
  const route = useRequestRoute(kind, kind === 'expense' ? routeAmount : null);
  const dateError =
    leaveKind === 'daily' && startsOn && endsOn
      ? endsOn < startsOn
        ? t('requests.form.dateOrder')
        : endsOn > addDays(startsOn, LEAVE_MAX_DAYS - 1)
          ? t('requests.form.tooLong', { days: formatNumber(LEAVE_MAX_DAYS) })
          : undefined
      : undefined;
  const approvers = route.data?.approvers ?? [];

  const request = (): CreateRequestRequest | null => {
    const uploadIds = uploads.map((u) => u.id);
    if (kind === 'leave') {
      if (leaveKind === 'daily') {
        if (!startsOn || dateError) return null;
        return {
          kind,
          data: { kind: 'daily', startsOn, endsOn: endsOn ?? startsOn, note: note.trim() },
        };
      }
      if (!startsOn || fromTime >= toTime) return null;
      return {
        kind,
        data: { kind: 'hourly', on: startsOn, from: fromTime, to: toTime, note: note.trim() },
      };
    }
    if (kind === 'expense') {
      if (!amountToman || amountTooSmall || description.trim().length < 3) return null;
      return {
        kind,
        data: { amountToman, category, description: description.trim() },
        uploadIds,
      };
    }
    if (title.trim().length < 2 || body.trim().length < 3) return null;
    return { kind, title: title.trim(), data: { body: body.trim() }, uploadIds };
  };
  const ready = request();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || files.pending.length) return;
    create.mutate(ready, {
      onSuccess: (detail) => {
        toast({ tone: 'success', title: t('requests.form.submitted') });
        router.push(`/requests/${detail.id}`);
      },
      onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
    });
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {kind === 'leave' && (
            <>
              <SelectField
                label={t('requests.form.leaveKind')}
                value={leaveKind}
                onChange={(e) => setLeaveKind(e.target.value as LeaveKind)}
                options={(['daily', 'hourly'] as const).map((k) => ({
                  value: k,
                  label: t(`requests.form.leaveKinds.${k}`),
                }))}
              />
              {leaveKind === 'daily' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <DatePicker
                    label={t('requests.form.from')}
                    value={startsOn}
                    onChange={setStartsOn}
                    today={today}
                  />
                  <div className="flex flex-col gap-1">
                    <DatePicker
                      label={t('requests.form.to')}
                      value={endsOn}
                      onChange={setEndsOn}
                      today={today}
                    />
                    {dateError && (
                      <p role="alert" className="text-sm text-danger-ink">
                        {dateError}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <DatePicker
                    label={t('requests.form.on')}
                    value={startsOn}
                    onChange={setStartsOn}
                    today={today}
                  />
                  <SelectField
                    label={t('requests.form.fromTime')}
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                    options={quarterTimeOptions()}
                  />
                  <SelectField
                    label={t('requests.form.toTime')}
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    options={quarterTimeOptions()}
                    error={fromTime >= toTime ? t('requests.form.timeOrder') : undefined}
                  />
                </div>
              )}
              <TextAreaField
                label={t('requests.form.note')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={2}
              />
            </>
          )}
          {kind === 'expense' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t('requests.form.amount')}
                  inputMode="numeric"
                  placeholder={t('requests.form.amountHint')}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => amountToman && setAmount(formatNumber(amountToman))}
                  error={amountTooSmall ? t('requests.form.amountMin') : undefined}
                  required
                />
                <SelectField
                  label={t('requests.form.category')}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  options={EXPENSE_CATEGORIES.map((c) => ({
                    value: c,
                    label: t(`requests.categories.${c}`),
                  }))}
                />
              </div>
              <TextAreaField
                label={t('requests.form.description')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={3}
                required
              />
            </>
          )}
          {kind === 'general' && (
            <>
              <TextField
                label={t('requests.form.title')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
              />
              <TextAreaField
                label={t('requests.form.body')}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                rows={4}
                required
              />
            </>
          )}
          {kind !== 'leave' && (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col gap-2">
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
                  label={
                    kind === 'expense' ? t('requests.form.invoice') : t('requests.form.attach')
                  }
                  onFiles={(picked) =>
                    void files
                      .upload(picked)
                      .then((done) => setUploads((list) => [...list, ...done]))
                  }
                />
              </div>
            </div>
          )}
          <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
            {approvers.length
              ? t('requests.form.routeTo', {
                  names: approvers.map((a) => a.displayName).join(t('requests.form.then')),
                })
              : route.isPending
                ? '…'
                : t('requests.form.routeNone')}
          </p>
          <Button
            type="submit"
            loading={create.isPending}
            disabled={!ready || files.pending.length > 0 || approvers.length === 0}
          >
            {t('requests.form.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
