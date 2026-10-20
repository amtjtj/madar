'use client';

import { MessageSquarePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { Button, Modal, TextField, useToast } from '@madar/ui';

import { RecipientPicker, type Person } from '@/components/letters/recipient-picker';
import { Segmented } from '@/components/work/task-views';
import { useCreateGroup, useStartDirect } from '@/hooks/chat';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';

/** One person opens (or reopens) a direct conversation; several make a named group. */
export function NewConversation() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const { data: me } = useMe();
  const direct = useStartDirect();
  const group = useCreateGroup();
  const router = useRouter();
  const { toast } = useToast();
  const close = () => {
    setOpen(false);
    setPeople([]);
    setTitle('');
    setProblem('');
  };
  const go = (id: string) => {
    close();
    router.push(`/chat/${id}`);
  };
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title={t('chat.new')}
      trigger={
        <Button size="sm" icon={<MessageSquarePlus aria-hidden />}>
          {t('chat.new')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label={t('chat.new')}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setProblem('');
          }}
          options={[
            { value: 'direct', label: t('chat.newDirect') },
            { value: 'group', label: t('chat.newGroup') },
          ]}
        />
        {mode === 'group' && (
          <TextField
            label={t('chat.groupName')}
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <RecipientPicker
          label={t('chat.people')}
          value={people}
          autoFocus
          exclude={me?.member ? [me.member.id] : []}
          onChange={(next) => {
            setProblem('');
            if (mode === 'direct' && next.length) {
              const person = next[next.length - 1];
              if (person)
                direct.mutate(person.id, {
                  onSuccess: (c) => go((c as { id: string }).id),
                  onError,
                });
              return;
            }
            setPeople(next);
          }}
        />
        {problem && (
          <p role="alert" className="text-sm font-semibold text-danger-ink">
            {problem}
          </p>
        )}
        {mode === 'group' && (
          <Button
            loading={group.isPending}
            onClick={() => {
              if (!title.trim()) return setProblem(t('chat.needsName'));
              if (!people.length) return setProblem(t('chat.choosePeople'));
              group.mutate(
                { title: title.trim(), memberIds: people.map((p) => p.id) },
                { onSuccess: (c) => go((c as { id: string }).id), onError },
              );
            }}
          >
            {t('chat.create')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
