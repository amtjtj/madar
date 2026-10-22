'use client';

import { CheckSquare, Stamp } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  calendarDateIn,
  formatNumber,
  taskTitleFromMessage,
  type Conversation,
  type Message,
} from '@madar/shared';
import { Button, DatePicker, Modal, Skeleton, TextField, useToast } from '@madar/ui';

import { RecipientPicker, type Person } from '@/components/letters/recipient-picker';
import { useCreateTaskFromMessage, useMessageTasks } from '@/hooks/chat';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';

/**
 * «ساختن کار» from a message (plan phase-2-step-15c): the title comes from the message, the task
 * goes to the conversation's project when there is one, and the message is pinned to it.
 */
export function MakeTaskDialog({
  message,
  conversation,
  onClose,
}: {
  message: Message | null;
  conversation: Conversation;
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const create = useCreateTaskFromMessage();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<Person[]>([]);
  const [dueOn, setDueOn] = useState<string | null>(null);
  // A new message fills the form; set during render, not in an effect.
  const [forId, setForId] = useState<string | null>(null);
  if ((message?.id ?? null) !== forId) {
    setForId(message?.id ?? null);
    setTitle(
      message
        ? taskTitleFromMessage(
            message.body,
            new Map(message.mentions.map((m) => [m.id, m.displayName])),
          )
        : '',
    );
    setAssignee([]);
    setDueOn(null);
  }
  const today = calendarDateIn(new Date(), me?.tenant?.timezone);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message || !title.trim()) return;
    create.mutate(
      {
        message,
        body: {
          title: title.trim(),
          assigneeId: assignee[0]?.id,
          dueOn,
          projectId: conversation.kind === 'project' ? conversation.projectId : null,
        },
      },
      {
        onSuccess: (task) => {
          toast({ tone: 'success', title: t('chat.taskMade', { title: task.title }) });
          onClose();
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <Modal
      open={message !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('chat.makeTask')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('today.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
        <div className="flex flex-col gap-1">
          <RecipientPicker
            label={t('chat.taskAssignee')}
            value={assignee}
            onChange={(next) => setAssignee(next.slice(-1))}
          />
          <p className="text-xs text-ink-muted">{t('chat.taskAssigneeHint')}</p>
        </div>
        <DatePicker label={t('today.dueLabel')} value={dueOn} onChange={setDueOn} today={today} />
        <p role="note" className="rounded-xl bg-info-soft p-3 text-sm text-info-ink">
          {t('chat.makeTaskNote')}
        </p>
        <div className="flex gap-3">
          <Button type="submit" loading={create.isPending} className="flex-1">
            {t('chat.makeTaskConfirm')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('chat.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** «کار شد» under a pinned message: the tasks the reader sees, and how many others. */
export function PinnedTasks({ message, mine }: { message: Message; mine: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, isPending } = useMessageTasks(message.id, open);
  if (message.pinnedCount === 0 || message.deleted) return null;
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('chat.pinnedTasksTitle')}
      trigger={
        <button
          type="button"
          className={
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-primary-ink hover:bg-primary-soft [&_svg]:size-3.5 ' +
            (mine ? 'self-end' : 'self-start')
          }
        >
          <Stamp aria-hidden />
          {message.pinnedCount === 1
            ? t('chat.pinnedOne')
            : t('chat.pinnedMany', { count: formatNumber(message.pinnedCount) })}
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
              {t('chat.pinnedHidden', { count: formatNumber(data?.hidden ?? 0) })}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
