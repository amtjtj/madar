'use client';

import { t } from '@madar/i18n';
import type { TemplateKey } from '@madar/shared';
import { cn, Skeleton, StatusChip } from '@madar/ui';

import { useTemplates } from '@/hooks/module-config';

/** Pick the built-in template a department starts from (plan phase-3-step-19a). */
export function TemplatePicker({
  value,
  onChange,
}: {
  value: TemplateKey;
  onChange: (key: TemplateKey) => void;
}) {
  const { data: templates } = useTemplates();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">
        {t('departmentConfig.template')}
      </legend>
      {!templates ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : (
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {templates.map((template) => {
            const on = template.key === value;
            return (
              <button
                key={template.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(template.key)}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  on
                    ? 'border-primary bg-primary-soft'
                    : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <span className="font-bold text-ink">{template.name}</span>
                <span className="text-xs text-ink-muted">{template.description}</span>
                <span className="flex flex-wrap gap-1">
                  {template.statuses
                    .filter((s) => s.category !== 'canceled')
                    .map((s) => (
                      <StatusChip key={s.key} label={s.label} color={s.color} />
                    ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
