'use client';

import { Archive, ArrowRight, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, type Project, type ProjectRole } from '@madar/shared';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Modal,
  ProgressBar,
  SelectField,
  Skeleton,
  useToast,
} from '@madar/ui';

import { NewTaskButton } from '@/components/work/new-task-button';
import { TaskViews } from '@/components/work/task-views';
import { useMembers } from '@/hooks/queries';
import { useArchiveProject, useProject, useSetProjectMembers, useTodayDate } from '@/hooks/work';
import { KeyResultSelect } from '@/components/goals/key-result-select';
import { useLinkKeyResult } from '@/hooks/goals';
import { errorMessage } from '@/lib/errors';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isPending, isError } = useProject(id);
  const today = useTodayDate();

  const back = (
    <Link
      href="/projects"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
    >
      <ArrowRight aria-hidden />
      {t('projects.title')}
    </Link>
  );

  if (isError) {
    return (
      <>
        {back}
        <Card>
          <EmptyState
            title={t('projects.notFoundTitle')}
            description={t('task.notFoundDescription')}
          />
        </Card>
      </>
    );
  }
  if (isPending || !project) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  const { done, total } = project.tasks;
  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-black text-ink md:text-3xl">{project.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {project.department && <span>{project.department.name}</span>}
            <Badge tone={project.visibility === 'private' ? 'warning' : 'neutral'}>
              {t(`projects.visibilities.${project.visibility}`)}
            </Badge>
          </div>
          {project.description && (
            <p className="max-w-prose whitespace-pre-line text-ink-muted">{project.description}</p>
          )}
        </div>
        <NewTaskButton today={today} addToToday={false} projectId={project.id} />
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
          <ProgressBar
            className="flex-1"
            value={total ? done / total : 0}
            label={t('projects.progress', { done: formatNumber(done), total: formatNumber(total) })}
            showValue={total > 0}
          />
          <div className="flex items-center gap-3">
            <AvatarGroup people={project.members.map((m) => ({ name: m.displayName }))} />
            {project.can.edit && <MembersButton project={project} />}
            {project.can.edit && project.status === 'active' && <ArchiveButton id={project.id} />}
          </div>
        </CardContent>
      </Card>

      {(project.can.edit || project.keyResult) && (
        <div className="mb-6 max-w-md">
          <ProjectKeyResult project={project} />
        </div>
      )}

      <h2 className="mb-3 text-lg font-bold text-ink">{t('projects.tasksTitle')}</h2>
      <TaskViews params={{ view: 'project', projectId: project.id }} showAssignee />
    </>
  );
}

function ProjectKeyResult({ project }: { project: Project }) {
  const link = useLinkKeyResult();
  const { toast } = useToast();
  return (
    <KeyResultSelect
      value={project.keyResult}
      disabled={!project.can.edit || link.isPending}
      onChange={(keyResultId) =>
        link.mutate(
          { kind: 'project', id: project.id, keyResultId },
          {
            onSuccess: () =>
              toast({
                tone: 'success',
                title: t(keyResultId ? 'goals.link.saved' : 'goals.link.cleared'),
                duration: 1500,
              }),
            onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
          },
        )
      }
    />
  );
}

function MembersButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState('');
  const { data: members } = useMembers();
  const setMembers = useSetProjectMembers();
  const { toast } = useToast();

  const save = (next: Array<{ memberId: string; role: ProjectRole }>) =>
    setMembers.mutate(
      { id: project.id, members: next },
      { onError: (error) => toast({ tone: 'error', title: errorMessage(error) }) },
    );
  const current = project.members.map((m) => ({ memberId: m.id, role: m.role }));
  const candidates = (members ?? []).filter(
    (m) => m.status === 'active' && !project.members.some((pm) => pm.id === m.id),
  );

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('projects.manageMembers')}
      trigger={
        <Button size="sm" variant="secondary" icon={<UserPlus aria-hidden />}>
          {t('projects.members')}
        </Button>
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        {project.members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={m.displayName} size="sm" />
            <span className="flex-1 font-medium text-ink">{m.displayName}</span>
            {m.role === 'owner' || m.id === project.owner.id ? (
              <Badge tone="primary">{t('projects.owner')}</Badge>
            ) : (
              <button
                type="button"
                aria-label={t('projects.removeMember', { name: m.displayName })}
                onClick={() => save(current.filter((c) => c.memberId !== m.id))}
                className="grid size-8 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
              >
                <X aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <SelectField
          className="flex-1"
          label={t('projects.addMember')}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          options={[
            { value: '', label: '—' },
            ...candidates.map((m) => ({ value: m.id, label: m.displayName })),
          ]}
        />
        <Button
          disabled={!adding}
          loading={setMembers.isPending}
          onClick={() => {
            save([...current, { memberId: adding, role: 'member' }]);
            setAdding('');
          }}
        >
          {t('projects.addMember')}
        </Button>
      </div>
    </Modal>
  );
}

function ArchiveButton({ id }: { id: string }) {
  const archive = useArchiveProject();
  const router = useRouter();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Archive aria-hidden />}
      loading={archive.isPending}
      onClick={() =>
        archive.mutate(id, {
          onSuccess: () => {
            toast({ tone: 'success', title: t('projects.archived') });
            router.replace('/projects');
          },
          onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
        })
      }
    >
      {t('projects.archive')}
    </Button>
  );
}
