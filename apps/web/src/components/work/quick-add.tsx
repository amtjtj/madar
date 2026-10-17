'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { TextField, useToast } from '@madar/ui';

import { useCreateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/** One-line task entry: type a title, press Enter; the task lands on today's plan at once. */
export function QuickAdd() {
  const [title, setTitle] = useState('');
  const create = useCreateTask();
  const { toast } = useToast();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    setTitle('');
    create.mutate(
      { title: value, addToToday: true },
      {
        onError: (error) => {
          setTitle((current) => current || value);
          toast({ tone: 'error', title: errorMessage(error) });
        },
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <TextField
        label={t('today.quickAddLabel')}
        hideLabel
        placeholder={t('today.quickAddPlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        enterKeyHint="done"
        icon={<Plus aria-hidden />}
        trailing={
          title.trim() ? (
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-3 text-sm font-bold text-on-primary"
            >
              {t('today.quickAddSubmit')}
            </button>
          ) : null
        }
      />
    </form>
  );
}
