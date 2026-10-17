'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { TASK_PRIORITIES, type TaskPriority } from '@madar/shared';
import {
  Button,
  CheckboxField,
  DatePicker,
  Modal,
  SelectField,
  TextField,
  useToast,
} from '@madar/ui';

import { useCreateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export interface NewTaskButtonProps {
  /** Today in the tenant time zone (for the date picker). */
  today: string;
  /** Default for «add to today». */
  addToToday?: boolean;
  projectId?: string;
}

/** Floating «new task» button on mobile, a regular button from md up; opens the full form. */
export function NewTaskButton({ today, addToToday = true, projectId }: NewTaskButtonProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [toToday, setToToday] = useState(addToToday);
  const create = useCreateTask();
  const { toast } = useToast();

  const reset = () => {
    setTitle('');
    setDueOn(null);
    setPriority('normal');
    setToToday(addToToday);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), dueOn, priority, addToToday: toToday, projectId },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: t('today.created') });
          reset();
          setOpen(false);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('today.newTaskTitle')}
      trigger={
        <Button
          aria-label={t('today.newTask')}
          icon={<Plus aria-hidden />}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] end-4 z-30 size-14 gap-0 rounded-full p-0 shadow-lg md:static md:size-auto md:gap-2 md:rounded-lg md:px-4 md:shadow-none"
        >
          <span className="hidden md:inline">{t('today.newTask')}</span>
        </Button>
      }
    >
      <form id="new-task-form" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('today.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
        <DatePicker label={t('today.dueLabel')} value={dueOn} onChange={setDueOn} today={today} />
        <SelectField
          label={t('today.priorityLabel')}
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: t(`work.priority.${p}`) }))}
        />
        <CheckboxField
          label={t('today.addToTodayCheckbox')}
          checked={toToday}
          onChange={(e) => setToToday(e.target.checked)}
        />
        <div className="flex gap-3">
          <Button type="submit" loading={create.isPending} className="flex-1">
            {t('today.create')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('today.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
