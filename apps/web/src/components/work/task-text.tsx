'use client';

import { useState } from 'react';

import { t } from '@madar/i18n';
import type { Task } from '@madar/shared';
import { TextAreaField, useToast } from '@madar/ui';

import { useUpdateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/** The task title, edited in place (Enter or leaving the field saves; Escape reverts). */
export function TitleEditor({ task }: { task: Task }) {
  const [value, setValue] = useState(task.title);
  const [shown, setShown] = useState(task.title);
  const update = useUpdateTask();
  const { toast } = useToast();
  // Follow changes made elsewhere (refetch, another tab).
  if (shown !== task.title) {
    setShown(task.title);
    setValue(task.title);
  }

  const save = () => {
    const title = value.trim();
    if (!title || title === task.title) return setValue(task.title);
    update.mutate(
      { id: task.id, version: task.version, title },
      { onError: (error) => toast({ tone: 'error', title: errorMessage(error) }) },
    );
  };

  if (!task.can.edit) {
    return <h1 className="text-2xl font-black break-words text-ink md:text-3xl">{task.title}</h1>;
  }
  return (
    <h1 className="text-2xl font-black text-ink md:text-3xl">
      <input
        aria-label={t('task.titleLabel')}
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(task.title);
            e.currentTarget.blur();
          }
        }}
        className="w-full rounded-lg bg-transparent px-1 -mx-1 outline-none hover:bg-sunken focus:bg-surface focus:ring-4 focus:ring-primary-soft"
      />
    </h1>
  );
}

/** Plain-text description (line breaks kept), saved when the field loses focus. */
export function DescriptionEditor({ task }: { task: Task }) {
  const [value, setValue] = useState(task.description ?? '');
  const [shown, setShown] = useState(task.description);
  const update = useUpdateTask();
  const { toast } = useToast();
  if (shown !== task.description) {
    setShown(task.description);
    setValue(task.description ?? '');
  }

  if (!task.can.edit) {
    return task.description ? (
      <p className="whitespace-pre-line leading-7 text-ink">{task.description}</p>
    ) : null;
  }
  return (
    <TextAreaField
      label={t('task.descriptionLabel')}
      placeholder={t('task.descriptionPlaceholder')}
      value={value}
      maxLength={10_000}
      rows={value ? Math.min(12, value.split('\n').length + 1) : 3}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const description = value.trim() || null;
        if (description === (task.description ?? null)) return;
        update.mutate(
          { id: task.id, version: task.version, description },
          { onError: (error) => toast({ tone: 'error', title: errorMessage(error) }) },
        );
      }}
    />
  );
}
