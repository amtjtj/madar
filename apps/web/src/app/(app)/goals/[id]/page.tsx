'use client';

import { Archive, ArrowRight, FolderKanban, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { keyResultRange, parseDecimal, type GoalDetail, type KeyResultKind } from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Modal,
  ProgressBar,
  SelectField,
  Skeleton,
  TextField,
  cn,
  statusDot,
  useToast,
} from '@madar/ui';

import { GoalCard, GoalStatusBadge } from '@/components/goals/goal-card';
import { KeyResultItem } from '@/components/goals/key-result-item';
import { useAddKeyResult, useArchiveGoal, useGoal } from '@/hooks/goals';
import { errorMessage } from '@/lib/errors';

export default function GoalPage() {
  const { id } = useParams<{ id: string }>();
  const { data: goal, isPending, isError } = useGoal(id);

  const back = (
    <Link
      href={goal?.parent ? `/goals/${goal.parent.id}` : '/goals'}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
    >
      <ArrowRight aria-hidden />
      {goal?.parent?.title ?? t('goals.title')}
    </Link>
  );

  if (isError) {
    return (
      <>
        {back}
        <Card>
          <EmptyState
            title={t('goals.detail.notFoundTitle')}
            description={t('goals.detail.notFoundHint')}
          />
        </Card>
      </>
    );
  }
  if (isPending || !goal) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>{t(`goals.levels.${goal.level}`)}</span>
          {goal.department && <span>، {goal.department.name}</span>}
          <span>
            ، {t('goals.owner')}: {goal.owner.displayName}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-black text-ink md:text-3xl">{goal.title}</h1>
          <GoalStatusBadge goal={goal} />
        </div>
        {goal.description && <p className="text-ink-muted">{goal.description}</p>}
        <ProgressBar value={goal.progress} size="lg" showValue label={t('goals.progressLabel')} />
      </div>

      <div className="grid gap-6 pb-20 md:pb-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">{t('goals.detail.keyResults')}</h2>
                {goal.can.edit && !goal.archivedAt && <AddKeyResult goalId={goal.id} />}
              </div>
              {goal.keyResults.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('goals.detail.noKeyResults')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {goal.keyResults.map((kr) => (
                    <KeyResultItem
                      key={kr.id}
                      goalId={goal.id}
                      kr={kr}
                      canEdit={goal.can.edit && !goal.archivedAt}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {goal.children.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-bold text-ink">{t('goals.detail.children')}</h2>
              <ul className="flex flex-col gap-3">
                {goal.children.map((child) => (
                  <li key={child.id}>
                    <GoalCard goal={child} showParent={false} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          <LinkedWork goal={goal} />
          {goal.can.edit && !goal.archivedAt && <ArchiveGoal goal={goal} />}
        </aside>
      </div>
    </>
  );
}

function LinkedWork({ goal }: { goal: GoalDetail }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h2 className="font-bold text-ink">{t('goals.detail.work')}</h2>
        {goal.tasks.length === 0 && goal.projects.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('goals.detail.noWork')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {goal.projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink hover:bg-sunken [&_svg]:size-4"
                >
                  <FolderKanban aria-hidden className="text-ink-muted" />
                  {p.name}
                </Link>
              </li>
            ))}
            {goal.tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-sunken"
                >
                  <span
                    aria-hidden
                    className={cn('size-2 shrink-0 rounded-full', statusDot[task.statusCategory])}
                  />
                  <span
                    className={task.statusCategory === 'done' ? 'text-ink-subtle line-through' : ''}
                  >
                    {task.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AddKeyResult({ goalId }: { goalId: string }) {
  const add = useAddKeyResult(goalId);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<KeyResultKind>('number');
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const num = parseDecimal;
  const body = {
    title: title.trim(),
    kind,
    ...(kind === 'number'
      ? { startValue: num(start) ?? 0, targetValue: num(target), unit: unit.trim() || null }
      : {}),
  };
  const valid = Boolean(body.title) && keyResultRange(body) !== null;

  const onOpenChange = (next: boolean) => {
    if (next) {
      setTitle('');
      setKind('number');
      setStart('');
      setTarget('');
      setUnit('');
    }
    setOpen(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(body, {
      onSuccess: () => {
        toast({ tone: 'success', title: t('goals.detail.keyResultAdded') });
        setOpen(false);
      },
      onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
    });
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('goals.detail.addKeyResult')}
      trigger={
        <Button size="sm" variant="ghost" icon={<Plus aria-hidden />}>
          {t('goals.detail.addKeyResult')}
        </Button>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('goals.form.krName')}
          placeholder={t('goals.form.krTitlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
        <SelectField
          label={t('goals.form.kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as KeyResultKind)}
          options={(['number', 'percent', 'boolean'] as const).map((k) => ({
            value: k,
            label: t(`goals.form.kinds.${k}`),
          }))}
        />
        {kind === 'number' && (
          <div className="grid grid-cols-3 gap-2">
            <TextField
              label={t('goals.form.start')}
              inputMode="decimal"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <TextField
              label={t('goals.form.target')}
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            />
            <TextField
              label={t('goals.form.unit')}
              placeholder={t('goals.form.unitPlaceholder')}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              maxLength={20}
            />
          </div>
        )}
        <Button type="submit" loading={add.isPending} disabled={!valid}>
          {t('goals.detail.addKeyResult')}
        </Button>
      </form>
    </Modal>
  );
}

function ArchiveGoal({ goal }: { goal: GoalDetail }) {
  const archive = useArchiveGoal();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('goals.detail.archive')}
      description={t('goals.detail.archiveConfirm')}
      trigger={
        <Button
          variant="ghost"
          className="self-start text-danger-ink"
          icon={<Archive aria-hidden />}
        >
          {t('goals.detail.archive')}
        </Button>
      }
    >
      <Button
        variant="danger"
        loading={archive.isPending}
        onClick={() =>
          archive.mutate(goal.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: t('goals.detail.archived') });
              router.replace(goal.parent ? `/goals/${goal.parent.id}` : '/goals');
            },
            onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
          })
        }
      >
        {t('goals.detail.archive')}
      </Button>
    </Modal>
  );
}
