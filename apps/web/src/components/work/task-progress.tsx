'use client';

import { useState } from 'react';

import { t } from '@madar/i18n';
import type { Task } from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  Modal,
  ProgressBar,
  Slider,
  TextField,
  useToast,
} from '@madar/ui';

import { useSetTaskProgress, useToggleDone, useUpdateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/**
 * «Progress» on a task (ADR 0018): a slider with a short note, or the value computed from the
 * subtasks. Reaching 100 % asks whether the task is done.
 */
export function TaskProgress({ task }: { task: Task }) {
  if (task.statusCategory === 'canceled') return null;
  const auto = task.subtasks.total > 0 && task.progressMode === 'auto';
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">{t('work.progress.title')}</h2>
        {task.statusCategory === 'done' ? (
          <ProgressBar value={1} label={t('work.progress.closed')} showValue />
        ) : auto ? (
          <AutoProgress task={task} />
        ) : (
          // Reset the draft whenever the saved task changes.
          <ProgressForm key={`${task.id}:${task.version}`} task={task} />
        )}
      </CardContent>
    </Card>
  );
}

function ModeButton({ task, mode }: { task: Task; mode: 'auto' | 'manual' }) {
  const update = useUpdateTask();
  const { toast } = useToast();
  if (!task.can.edit || task.subtasks.total === 0) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="self-start"
      loading={update.isPending}
      onClick={() =>
        update.mutate(
          { id: task.id, version: task.version, progressMode: mode },
          { onError: (error) => toast({ tone: 'error', title: errorMessage(error) }) },
        )
      }
    >
      {mode === 'manual' ? t('work.progress.toManual') : t('work.progress.toAuto')}
    </Button>
  );
}

function AutoProgress({ task }: { task: Task }) {
  return (
    <>
      <ProgressBar value={task.progress / 100} label={t('work.progress.auto')} showValue />
      <p className="text-sm text-ink-muted">{t('work.progress.autoHint')}</p>
      <ModeButton task={task} mode="manual" />
    </>
  );
}

function ProgressForm({ task }: { task: Task }) {
  const [value, setValue] = useState(task.progress);
  const [note, setNote] = useState('');
  const [askDone, setAskDone] = useState<Task | null>(null);
  const save = useSetTaskProgress();
  const toggle = useToggleDone();
  const { toast } = useToast();
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });
  const changed = value !== task.progress || note.trim() !== '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        save.mutate(
          { id: task.id, version: task.version, value, ...(note.trim() ? { note } : {}) },
          {
            onSuccess: (saved) => {
              toast({ tone: 'success', title: t('work.progress.saved'), duration: 1500 });
              if (saved.progress === 100) setAskDone(saved);
            },
            onError,
          },
        );
      }}
    >
      <Slider
        label={t('work.progress.slider')}
        value={value}
        onChange={setValue}
        disabled={!task.can.edit}
      />
      {task.can.edit && (
        <>
          <TextField
            label={t('work.progress.note')}
            placeholder={t('work.progress.notePlaceholder')}
            value={note}
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!changed} loading={save.isPending}>
              {t('work.progress.save')}
            </Button>
            {task.subtasks.total > 0 && <ModeButton task={task} mode="auto" />}
          </div>
        </>
      )}
      <Modal
        open={askDone !== null}
        onOpenChange={(open) => !open && setAskDone(null)}
        title={t('work.progress.doneTitle')}
        description={t('work.progress.doneBody')}
      >
        <div className="flex gap-3">
          <Button
            className="flex-1"
            loading={toggle.isPending}
            onClick={() => {
              if (!askDone) return;
              void toggle
                .toggle(askDone, true)
                .then(() => setAskDone(null))
                .catch(onError);
            }}
          >
            {t('work.progress.doneYes')}
          </Button>
          <Button variant="ghost" onClick={() => setAskDone(null)}>
            {t('work.progress.doneNo')}
          </Button>
        </div>
      </Modal>
    </form>
  );
}
