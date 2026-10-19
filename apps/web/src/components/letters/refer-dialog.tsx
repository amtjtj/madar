'use client';

import { Forward } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import type { Letter } from '@madar/shared';
import { Button, Modal, TextAreaField, useToast } from '@madar/ui';

import { useReferLetter } from '@/hooks/letters';
import { errorMessage } from '@/lib/errors';

import { RecipientPicker, type Person } from './recipient-picker';

/** Refer a letter to colleagues with a note; they see this letter, not its thread. */
export function ReferDialog({ letter, className }: { letter: Letter; className?: string }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const refer = useReferLetter();
  const { toast } = useToast();
  const onLetter = [letter.sender.id, ...letter.recipients.map((r) => r.id)];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPeople([]);
          setNote('');
          setError('');
        }
      }}
      title={t('letters.referDialog.title')}
      trigger={
        <Button variant="secondary" icon={<Forward aria-hidden />} className={className}>
          {t('letters.refer')}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!people.length) {
            setError(t('letters.referDialog.needsPerson'));
            return;
          }
          refer.mutate(
            { id: letter.id, body: { memberIds: people.map((p) => p.id), note: note.trim() } },
            {
              onSuccess: () => {
                toast({ tone: 'success', title: t('letters.referDialog.done') });
                setOpen(false);
                setPeople([]);
                setNote('');
              },
              onError: (err) => toast({ tone: 'error', title: errorMessage(err) }),
            },
          );
        }}
      >
        <RecipientPicker
          label={t('letters.referDialog.people')}
          value={people}
          onChange={(next) => {
            setPeople(next);
            setError('');
          }}
          exclude={onLetter}
          autoFocus
        />
        {error && (
          <p role="alert" className="text-sm text-danger-ink">
            {error}
          </p>
        )}
        <TextAreaField
          label={t('letters.referDialog.note')}
          placeholder={t('letters.referDialog.notePlaceholder')}
          maxLength={500}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" loading={refer.isPending} icon={<Forward aria-hidden />}>
          {t('letters.referDialog.submit')}
        </Button>
      </form>
    </Modal>
  );
}
