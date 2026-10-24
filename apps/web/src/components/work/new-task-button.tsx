'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  defaultType,
  fieldsOf,
  TASK_PRIORITIES,
  type FieldValue as Value,
  type TaskPriority,
} from '@madar/shared';
import {
  Button,
  CheckboxField,
  DatePicker,
  FieldInput,
  Modal,
  SelectField,
  TextField,
  useToast,
} from '@madar/ui';

import { useModuleConfigs } from '@/hooks/module-config';
import { useDepartments, useMembers } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { useCreateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export interface NewTaskButtonProps {
  /** Today in the tenant time zone (for the date picker). */
  today: string;
  /** Default for «add to today». */
  addToToday?: boolean;
  projectId?: string;
  /** The department the task goes to (a project's or the filtered one); else the member picks. */
  departmentId?: string | null;
  /** The department's own word, e.g. «تیکت تازه» (plan phase-3-step-19a). */
  label?: string;
}

/** Floating «new task» button on mobile, a regular button from md up; opens the full form. */
export function NewTaskButton({
  today,
  addToToday = true,
  projectId,
  departmentId: fixedDepartment,
  label,
}: NewTaskButtonProps) {
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const { data: configs } = useModuleConfigs();
  // Departments I add work to (not those I only view); a project decides for itself.
  const mine = (me?.member?.departments ?? []).filter((d) => d.deptRole !== 'viewer');
  const [chosenDepartment, setChosenDepartment] = useState<string | null>(null);
  // A project without a department lets the API pick (my primary one): then no type or fields
  // here, since this form cannot know that department's config for sure.
  const departmentId = projectId
    ? (fixedDepartment ?? null)
    : (fixedDepartment ?? chosenDepartment ?? mine[0]?.id ?? null);
  const config = configs?.find((c) => c.departmentId === departmentId)?.config ?? null;
  const [chosenType, setChosenType] = useState<string | null>(null);
  const type =
    config?.workItemTypes.find((w) => w.key === chosenType) ??
    (config ? defaultType(config) : null);
  const fields = config && type ? fieldsOf(config, type.key) : [];
  const [values, setValues] = useState<Record<string, Value>>({});
  const { data: members } = useMembers();
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
    setChosenType(null);
    setValues({});
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      {
        title: title.trim(),
        dueOn,
        priority,
        addToToday: toToday,
        projectId,
        // The type and its fields only when the form knew them (the API then checks required ones).
        ...(!projectId && departmentId && { departmentId }),
        ...(type && { typeKey: type.key, customFields: values }),
      },
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
      title={label ?? t('today.newTaskTitle')}
      trigger={
        <Button
          aria-label={label ?? t('today.newTask')}
          icon={<Plus aria-hidden />}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] end-4 z-30 size-14 gap-0 rounded-full p-0 shadow-lg md:static md:size-auto md:gap-2 md:rounded-lg md:px-4 md:shadow-none"
        >
          <span className="hidden md:inline">{label ?? t('today.newTask')}</span>
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
        {!projectId && !fixedDepartment && mine.length > 1 && (
          <SelectField
            label={t('task.department')}
            value={departmentId ?? ''}
            onChange={(e) => {
              setChosenDepartment(e.target.value);
              setChosenType(null);
              setValues({});
            }}
            options={mine.map((d) => ({
              value: d.id,
              label: departments?.find((x) => x.id === d.id)?.name ?? '',
            }))}
          />
        )}
        {config && config.workItemTypes.length > 1 && type && (
          <SelectField
            label={t('task.type')}
            value={type.key}
            onChange={(e) => {
              setChosenType(e.target.value);
              setValues({});
            }}
            options={config.workItemTypes.map((w) => ({ value: w.key, label: w.label }))}
          />
        )}
        <DatePicker label={t('today.dueLabel')} value={dueOn} onChange={setDueOn} today={today} />
        <SelectField
          label={t('today.priorityLabel')}
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: t(`work.priority.${p}`) }))}
        />
        {fields.map((field) => (
          <FieldInput
            key={`${type?.key}-${field.key}`}
            field={field}
            value={values[field.key]}
            onChange={(value) =>
              setValues((current) => {
                const rest = Object.fromEntries(
                  Object.entries(current).filter(([key]) => key !== field.key),
                );
                return value === null ? rest : { ...rest, [field.key]: value };
              })
            }
            today={today}
            members={field.type === 'member' ? (members ?? []) : []}
          />
        ))}
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
