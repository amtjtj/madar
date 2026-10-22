'use client';

import { Search, Stamp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, type EvidenceKind, type Letter, type Task } from '@madar/shared';
import { Button, Modal, Skeleton, TextField, useToast } from '@madar/ui';

import { useEditableTasks, usePinEvidence } from '@/hooks/evidence';
import { errorMessage } from '@/lib/errors';

import { ConfirmPin } from './task-evidence';

/** «سنجاق به کار» on a letter: pick a task I edit, see who will see it, pin. */
export function PinToTask({ letter }: { letter: Letter }) {
  const [open, setOpen] = useState(false);
  return (
    <PinToTaskDialog
      kind="letter"
      subjectId={letter.id}
      excludeTaskIds={letter.pinnedTo.map((p) => p.taskId)}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" icon={<Stamp aria-hidden />}>
          {t('evidence.pinToTask')}
        </Button>
      }
    />
  );
}

/** Picking a task to pin a letter or a message to (plan phase-2-step-15c). */
export function PinToTaskDialog({
  kind,
  subjectId,
  excludeTaskIds = [],
  open,
  onOpenChange,
  onPinned,
  trigger,
}: {
  kind: EvidenceKind;
  subjectId: string;
  excludeTaskIds?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPinned?: () => void;
  trigger?: ReactNode;
}) {
  const setOpen = onOpenChange;
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Task | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data: tasks, isPending } = useEditableTasks(search, open);
  const pin = usePinEvidence();
  const { toast } = useToast();
  const pinned = new Set(excludeTaskIds);
  const options = (tasks ?? []).filter((task) => !pinned.has(task.id)).slice(0, 20);
  const close = () => {
    setOpen(false);
    setChosen(null);
    setQuery('');
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title={t(kind === 'message' ? 'evidence.pinMessageTitle' : 'evidence.pinToTaskTitle')}
      trigger={trigger}
    >
      {chosen ? (
        <ConfirmPin
          taskId={chosen.id}
          subject={chosen.title}
          kind={kind}
          busy={pin.isPending}
          onBack={() => setChosen(null)}
          onPin={() =>
            pin.mutate(
              { taskId: chosen.id, kind, subjectId },
              {
                onSuccess: () => {
                  toast({
                    tone: 'success',
                    title: t(kind === 'message' ? 'evidence.messagePinned' : 'evidence.pinned'),
                  });
                  onPinned?.();
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
            label={t('evidence.searchTasks')}
            hideLabel
            type="search"
            placeholder={t('evidence.searchTasks')}
            icon={<Search aria-hidden />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p role="status" className="sr-only">
            {t('evidence.results', { count: formatNumber(options.length) })}
          </p>
          {isPending ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : !options.length ? (
            <p className="py-2 text-sm text-ink-muted">{t('evidence.noTasks')}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {options.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    aria-label={t('evidence.choose', { subject: task.title })}
                    onClick={() => setChosen(task)}
                    className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-start hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="truncate font-medium text-ink">{task.title}</span>
                    <span className="truncate text-xs text-ink-subtle">
                      {task.project?.name ?? task.department.name}
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
