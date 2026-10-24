'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { fieldsOf, formatNumber, type FieldValue as Value, type Task } from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldInput,
  FieldValue,
  useToast,
} from '@madar/ui';

import { useDepartmentConfig } from '@/hooks/module-config';
import { useMembers } from '@/hooks/queries';
import { useTodayDate, useUpdateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/**
 * The task type's custom fields (plan phase-3-step-19a): read as a list, edited together and
 * saved once. Hidden when the type has none.
 */
export function TaskCustomFields({ task }: { task: Task }) {
  const config = useDepartmentConfig(task.department.id);
  const fields = config ? fieldsOf(config, task.typeKey) : [];
  const hasMember = fields.some((f) => f.type === 'member');
  const { data: members } = useMembers();
  const today = useTodayDate();
  const update = useUpdateTask();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Value | null>>({});

  if (fields.length === 0) return null;
  const values = task.customFields as Record<string, Value>;
  const missing = fields.filter((f) => f.required && values[f.key] === undefined).length;
  const memberOptions = hasMember ? (members ?? []) : [];

  const save = () => {
    const changes = Object.fromEntries(
      Object.entries(draft).filter(
        ([key, value]) => JSON.stringify(value ?? undefined) !== JSON.stringify(values[key]),
      ),
    );
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: task.id, version: task.version, customFields: changes },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: t('task.saved'), duration: 1500 });
          setEditing(false);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{t('task.details')}</CardTitle>
        {task.can.edit && !editing && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil aria-hidden />}
            onClick={() => {
              setDraft({});
              setEditing(true);
            }}
          >
            {t('task.detailsEdit')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={field.key in draft ? (draft[field.key] ?? undefined) : values[field.key]}
                onChange={(value) => setDraft((d) => ({ ...d, [field.key]: value }))}
                today={today}
                members={memberOptions}
              />
            ))}
            <div className="flex gap-3">
              <Button type="submit" loading={update.isPending} className="flex-1">
                {t('task.detailsSave')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {t('task.detailsCancel')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {missing > 0 && (
              <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                {t('task.detailsMissing', { count: formatNumber(missing) })}
              </p>
            )}
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-ink-muted">{field.label}</dt>
                  <dd className="min-w-0 font-medium text-ink">
                    <FieldValue field={field} value={values[field.key]} members={memberOptions} />
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
