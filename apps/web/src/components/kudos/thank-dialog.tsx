'use client';

import { Heart } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, type ValueTag } from '@madar/shared';
import {
  Button,
  CheckboxField,
  LevelUpMark,
  Modal,
  TextAreaField,
  ValueTagPicker,
  useToast,
} from '@madar/ui';

import { RecipientPicker, type Person } from '@/components/letters/recipient-picker';
import { useGiveKudos, useKudosAllowance } from '@/hooks/kudos';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';

/**
 * «تشکر از همکار» (ADR 0030): pick a colleague (unless given), a value and one line. Shows how
 * many thanks are left this week; nothing is counted or compared across people.
 */
export function ThankDialog({
  to,
  taskId,
  trigger,
}: {
  to?: Person;
  taskId?: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();
  const allowance = useKudosAllowance(open);
  const give = useGiveKudos();
  const { toast } = useToast();
  const [people, setPeople] = useState<Person[]>(to ? [to] : []);
  const [tag, setTag] = useState<ValueTag | null>(null);
  const [message, setMessage] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [sent, setSent] = useState(false);
  const target = people[0];
  const left = allowance.data?.left ?? 0;
  const ready = !!target && !!tag && message.trim().length >= 3 && left > 0;

  const reset = () => {
    setPeople(to ? [to] : []);
    setTag(null);
    setMessage('');
    setPrivate(false);
    setSent(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !target || !tag) return;
    give.mutate(
      { toMemberId: target.id, valueTag: tag, message: message.trim(), taskId, private: isPrivate },
      {
        onSuccess: () => {
          setSent(true);
          toast({ tone: 'success', title: t('kudos.sent') });
          setTimeout(() => {
            setOpen(false);
            reset();
          }, 700);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      trigger={
        trigger ?? (
          <Button variant="secondary" size="sm" icon={<Heart aria-hidden />}>
            {to ? t('kudos.thankPerson', { name: to.displayName }) : t('kudos.thankSomeone')}
          </Button>
        )
      }
      title={t('kudos.dialogTitle')}
    >
      {sent ? (
        <LevelUpMark />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!to && (
            <RecipientPicker
              label={t('kudos.who')}
              value={people}
              onChange={(next) => setPeople(next.slice(-1))}
              exclude={me?.member ? [me.member.id] : []}
            />
          )}
          <ValueTagPicker label={t('kudos.tag')} value={tag} onChange={setTag} />
          <TextAreaField
            label={t('kudos.message')}
            placeholder={t('kudos.messageHint')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={280}
            rows={2}
          />
          <CheckboxField
            label={t('kudos.private')}
            checked={isPrivate}
            onChange={(e) => setPrivate(e.target.checked)}
          />
          <p role="status" className="text-sm text-ink-muted">
            {allowance.data
              ? left > 0
                ? t('kudos.left', { count: formatNumber(left) })
                : t('kudos.none')
              : '…'}
          </p>
          <Button type="submit" loading={give.isPending} disabled={!ready}>
            {t('kudos.send')}
          </Button>
        </form>
      )}
    </Modal>
  );
}
