'use client';

import { Target } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import type { KeyResultRef } from '@madar/shared';
import { SelectField } from '@madar/ui';

import { useKeyResultOptions } from '@/hooks/goals';

/** «Which key result does this serve?» for a task or project, with a link to its goal. */
export function KeyResultSelect({
  value,
  disabled,
  onChange,
}: {
  value: KeyResultRef;
  disabled?: boolean;
  onChange: (keyResultId: string | null) => void;
}) {
  const { data: options } = useKeyResultOptions(!disabled);
  const choices = [
    // The current link stays selectable even when it is not offered (e.g. last season).
    ...(value && !options?.some((o) => o.id === value.id)
      ? [{ value: value.id, label: `${value.title} (${value.goal.title})` }]
      : []),
    ...(options ?? []).map((o) => ({ value: o.id, label: `${o.title} (${o.goal.title})` })),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <SelectField
        label={t('goals.link.label')}
        hint={value ? undefined : t('goals.link.hint')}
        value={value?.id ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        options={[{ value: '', label: t('goals.link.none') }, ...choices]}
      />
      {value && (
        <Link
          href={`/goals/${value.goal.id}`}
          className="inline-flex items-center gap-1 self-start text-xs font-semibold text-primary-ink hover:underline [&_svg]:size-3.5"
        >
          <Target aria-hidden />
          {t('goals.link.goal', { title: value.goal.title })}
        </Link>
      )}
    </div>
  );
}
