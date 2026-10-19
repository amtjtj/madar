'use client';

import { ArrowRight, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import { formatRelativeTime } from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  CompleteCheck,
  EmptyState,
  Modal,
  Skeleton,
  useToast,
} from '@madar/ui';
import { useState } from 'react';

import { ActivityList } from '@/components/work/activity-list';
import { TaskEvidence } from '@/components/evidence/task-evidence';
import { TaskAttachments } from '@/components/work/attachments';
import { CommentThread } from '@/components/work/comment-thread';
import { Subtasks } from '@/components/work/subtasks';
import { TaskFields } from '@/components/work/task-fields';
import { TaskProgress } from '@/components/work/task-progress';
import { TitleEditor, DescriptionEditor } from '@/components/work/task-text';
import { useDeleteTask, useTask, useToggleDone } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isPending, isError } = useTask(id);
  const toggle = useToggleDone();
  const { toast } = useToast();
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  const back = (
    <Link
      href={task?.project ? `/projects/${task.project.id}` : '/tasks'}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
    >
      <ArrowRight aria-hidden />
      {task?.project?.name ?? t('task.back')}
    </Link>
  );

  if (isError) {
    return (
      <>
        {back}
        <Card>
          <EmptyState title={t('task.notFoundTitle')} description={t('task.notFoundDescription')} />
        </Card>
      </>
    );
  }
  if (isPending || !task) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  return (
    <>
      {back}
      <div className="mb-6 flex items-start gap-3">
        <CompleteCheck
          size="lg"
          className="mt-1"
          label={task.title}
          checked={task.statusCategory === 'done'}
          disabled={!task.can.edit}
          onCheckedChange={(done) => void toggle.toggle(task, done).catch(onError)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TitleEditor task={task} />
          <p className="text-sm text-ink-muted">
            {task.department.name} ·{' '}
            {t('task.createdAt', { time: formatRelativeTime(new Date(task.createdAt)) })}
          </p>
        </div>
      </div>
      {!task.can.edit && <p className="mb-4 text-sm text-ink-muted">{t('task.readOnly')}</p>}

      {/* Phones: progress, then the fields, then the body. Desktop: fields in the side column. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-first min-w-0 empty:hidden lg:col-start-1 lg:row-start-1">
          <TaskProgress task={task} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
          <DescriptionEditor task={task} />
          <TaskAttachments taskId={task.id} />
          <TaskEvidence taskId={task.id} canPin={task.can.edit} />
          {!task.parentId && <Subtasks task={task} />}
          <CommentThread taskId={task.id} />
          <ActivityList taskId={task.id} />
        </div>
        <aside className="order-first flex flex-col gap-4 lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <Card>
            <CardContent>
              <TaskFields task={task} />
            </CardContent>
          </Card>
          {task.can.delete && <DeleteTask id={task.id} projectId={task.project?.id} />}
        </aside>
      </div>
    </>
  );
}

function DeleteTask({ id, projectId }: { id: string; projectId?: string }) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteTask();
  const router = useRouter();
  const { toast } = useToast();
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('task.deleteTitle')}
      description={t('task.deleteDescription')}
      trigger={
        <Button
          variant="ghost"
          className="self-start text-danger-ink"
          icon={<Trash2 aria-hidden />}
        >
          {t('task.deleteTask')}
        </Button>
      }
    >
      <div className="flex gap-3">
        <Button
          variant="danger"
          className="flex-1"
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(id, {
              onSuccess: () => {
                toast({ tone: 'success', title: t('task.deleted') });
                router.replace(projectId ? `/projects/${projectId}` : '/tasks');
              },
              onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
            })
          }
        >
          {t('task.delete')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('task.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
