'use client';

import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  CHECKIN_STATUSES,
  formatNumber,
  parseDecimal,
  type CheckinStatus,
  type KeyResult,
} from '@madar/shared';
import { Button, CheckboxField, Modal, TextAreaField, TextField, cn, useToast } from '@madar/ui';

import { useCheckIn } from '@/hooks/goals';
import { errorMessage } from '@/lib/errors';

const STATUS_STYLE: Record<CheckinStatus, string> = {
  on_track:
    'aria-checked:border-success aria-checked:bg-success-soft aria-checked:text-success-ink',
  at_risk: 'aria-checked:border-warning aria-checked:bg-warning-soft aria-checked:text-warning-ink',
  off_track: 'aria-checked:border-danger aria-checked:bg-danger-soft aria-checked:text-danger-ink',
};

/** «Record progress» for one key result: new value, status and an optional note. */
export function CheckinSheet({ goalId, kr }: { goalId: string; kr: KeyResult }) {
  const checkIn = useCheckIn(goalId);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<CheckinStatus>('on_track');
  const [note, setNote] = useState('');

  const onOpenChange = (next: boolean) => {
    if (next) {
      setValue(formatNumber(kr.currentValue, { useGrouping: false }));
      setDone(kr.currentValue >= 1);
      setStatus(kr.status ?? 'on_track');
      setNote('');
    }
    setOpen(next);
  };

  const parsed = kr.kind === 'boolean' ? (done ? 1 : 0) : (parseDecimal(value) ?? NaN);
  const valid =
    Number.isFinite(parsed) && (kr.kind !== 'percent' || (parsed >= 0 && parsed <= 100));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    checkIn.mutate(
      { keyResultId: kr.id, value: parsed, status, note: note.trim() || null },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: t('goals.checkin.saved'), duration: 1500 });
          setOpen(false);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('goals.checkin.title')}
      description={kr.title}
      trigger={
        <Button size="sm" variant="secondary">
          {t('goals.checkin.action')}
        </Button>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {kr.kind === 'boolean' ? (
          <CheckboxField
            label={t('goals.checkin.done')}
            checked={done}
            onChange={(e) => setDone(e.target.checked)}
          />
        ) : (
          <TextField
            label={t('goals.checkin.value')}
            hint={t('goals.checkin.valueHint', {
              start: formatNumber(kr.startValue),
              target: formatNumber(kr.targetValue),
            })}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
          />
        )}
        <div
          role="radiogroup"
          aria-label={t('goals.checkin.status')}
          className="flex flex-col gap-2"
        >
          <span className="text-sm font-medium text-ink">{t('goals.checkin.status')}</span>
          <div className="grid grid-cols-3 gap-2">
            {CHECKIN_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  'h-11 rounded-lg border-2 border-line text-sm font-semibold text-ink-muted transition-colors hover:bg-sunken',
                  STATUS_STYLE[s],
                )}
              >
                {t(`goals.statuses.${s}`)}
              </button>
            ))}
          </div>
        </div>
        <TextAreaField
          label={t('goals.checkin.note')}
          placeholder={t('goals.checkin.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
        />
        <Button type="submit" loading={checkIn.isPending} disabled={!valid}>
          {t('goals.checkin.submit')}
        </Button>
      </form>
    </Modal>
  );
}
