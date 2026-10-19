'use client';

import { Archive, ArrowRight, Eye } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import { formatNumber, type Project } from '@madar/shared';
import {
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ProgressBar,
  Skeleton,
  useToast,
} from '@madar/ui';

import { NewTaskButton } from '@/components/work/new-task-button';
import { ProjectMembers } from '@/components/work/project-members';
import { TaskViews } from '@/components/work/task-views';
import { useArchiveProject, useProject, useTodayDate } from '@/hooks/work';
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
  const observers = project.members.filter((m) => m.role === 'observer').length;
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
        {project.can.createTask && (
          <NewTaskButton today={today} addToToday={false} projectId={project.id} />
        )}
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
          <ProgressBar
            className="flex-1"
            value={project.tasks.progress}
            label={t('projects.progress', { done: formatNumber(done), total: formatNumber(total) })}
            showValue={total > 0}
          />
          <div className="flex items-center gap-3">
            <AvatarGroup people={project.members.map((m) => ({ name: m.displayName }))} />
            {observers > 0 && (
              <Badge tone="neutral">
                <Eye aria-hidden />
                {t('projects.observers', { count: formatNumber(observers) })}
              </Badge>
            )}
            {project.can.edit && <ProjectMembers project={project} />}
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
