'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { PROJECT_VISIBILITIES, type Project } from '@madar/shared';
import {
  Button,
  DatePicker,
  Modal,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@madar/ui';

import { useDepartments } from '@/hooks/queries';
import { leadsCompany, managedDepartments } from '@/lib/roles';
import { useMe } from '@/hooks/use-me';
import { useCreateProject, useTodayDate } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

type Visibility = (typeof PROJECT_VISIBILITIES)[number];

export function NewProjectButton() {
  const router = useRouter();
  const today = useTodayDate();
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const create = useCreateProject();
  const { toast } = useToast();
  // Projects come from department managers and the leadership (plan phase-3-step-17a).
  const leads = leadsCompany(me?.member);
  const myDepartments = managedDepartments(me?.member);
  const choices = (departments ?? []).filter((d) => leads || myDepartments.includes(d.id));

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('department');
  const [dueOn, setDueOn] = useState<string | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setName('');
      setDescription('');
      setDepartmentId(myDepartments[0] ?? '');
      setVisibility(myDepartments.length ? 'department' : 'private');
      setDueOn(null);
    }
    setOpen(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        departmentId: departmentId || null,
        visibility,
        dueOn,
      },
      {
        onSuccess: (project) => {
          toast({ tone: 'success', title: t('projects.created') });
          setOpen(false);
          router.push(`/projects/${(project as Project).id}`);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  const visibilities = PROJECT_VISIBILITIES.filter((v) => v !== 'department' || departmentId);
  if (!leads && myDepartments.length === 0) return null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('projects.newTitle')}
      trigger={<Button icon={<Plus aria-hidden />}>{t('projects.new')}</Button>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('projects.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={120}
          required
          autoFocus
        />
        <TextAreaField
          label={t('projects.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={10_000}
        />
        <SelectField
          label={t('projects.department')}
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            if (!e.target.value && visibility === 'department') setVisibility('private');
          }}
          options={[
            ...(leads ? [{ value: '', label: t('projects.noDepartment') }] : []),
            ...choices.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <SelectField
          label={t('projects.visibility')}
          value={visibility}
          hint={t(`projects.visibilityHints.${visibility}`)}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          options={visibilities.map((v) => ({ value: v, label: t(`projects.visibilities.${v}`) }))}
        />
        <DatePicker label={t('projects.due')} value={dueOn} onChange={setDueOn} today={today} />
        <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
          {t('projects.create')}
        </Button>
      </form>
    </Modal>
  );
}
