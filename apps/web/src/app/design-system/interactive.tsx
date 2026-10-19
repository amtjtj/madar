'use client';

import { ChartColumn, Flame, House, ListTodo, Settings, Target, Users } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { addDays, formatNumber } from '@madar/shared';
import {
  Avatar,
  Badge,
  BottomNav,
  Button,
  BoardColumn,
  CompleteCheck,
  DatePicker,
  TaskCard,
  Modal,
  ModalClose,
  OrbitIllustration,
  ProgressBar,
  Sidebar,
  Slider,
  SortableList,
  SourceBadge,
  type TaskSourceInfo,
  cn,
  useToast,
  type LinkComponent,
  type NavItem,
} from '@madar/ui';

export function FeedbackDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            tone: 'success',
            title: t('designSystem.feedback.successTitle'),
            description: t('designSystem.feedback.successBody'),
            action: { label: t('designSystem.feedback.undo'), onClick: () => undefined },
          })
        }
      >
        {t('designSystem.feedback.showSuccess')}
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            tone: 'error',
            title: t('designSystem.feedback.errorTitle'),
            description: t('designSystem.feedback.errorBody'),
          })
        }
      >
        {t('designSystem.feedback.showError')}
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            tone: 'info',
            title: t('designSystem.feedback.infoTitle'),
            description: t('designSystem.feedback.infoBody'),
          })
        }
      >
        {t('designSystem.feedback.showInfo')}
      </Button>
      <Modal
        trigger={<Button variant="danger">{t('designSystem.feedback.openModal')}</Button>}
        title={t('designSystem.feedback.modalTitle')}
        description={t('designSystem.feedback.modalBody')}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost">{t('designSystem.feedback.modalCancel')}</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button variant="danger">{t('designSystem.feedback.modalConfirm')}</Button>
            </ModalClose>
          </>
        }
      />
    </div>
  );
}

const navItems: NavItem[] = [
  { key: 'today', label: t('nav.today'), href: '#today', icon: <House aria-hidden /> },
  { key: 'tasks', label: t('nav.tasks'), href: '#tasks', icon: <ListTodo aria-hidden />, count: 3 },
  { key: 'goals', label: t('nav.goals'), href: '#goals', icon: <Target aria-hidden /> },
  { key: 'team', label: t('nav.team'), href: '#team', icon: <Users aria-hidden /> },
  { key: 'reports', label: t('nav.reports'), href: '#reports', icon: <ChartColumn aria-hidden /> },
];

export function NavigationDemo() {
  const [active, setActive] = useState('today');
  // Preview links switch the active item instead of navigating.
  const PreviewLink: LinkComponent = ({ href, children, ...props }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        setActive(href.slice(1));
      }}
    >
      {children}
    </a>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-semibold text-ink-muted">
          {t('designSystem.navigation.desktop')}
        </figcaption>
        <div className="w-fit max-w-full overflow-hidden rounded-2xl border border-line">
          <Sidebar
            floating={false}
            items={[
              ...navItems,
              {
                key: 'settings',
                label: t('nav.settings'),
                href: '#settings',
                icon: <Settings aria-hidden />,
              },
            ]}
            activeKey={active}
            link={PreviewLink}
            sectionLabel={t('nav.workspace')}
            brand={
              <div className="flex items-center gap-2">
                <OrbitIllustration className="h-9" />
                <span className="text-xl font-black text-ink">{t('app.name')}</span>
              </div>
            }
            footer={
              <div className="flex items-center gap-3 px-2">
                <Avatar name={t('designSystem.navigation.userName')} status="online" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-ink">
                    {t('designSystem.navigation.userName')}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {t('designSystem.navigation.userRole')}
                  </span>
                </div>
              </div>
            }
            className="h-[34rem]"
          />
        </div>
      </figure>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-semibold text-ink-muted">
          {t('designSystem.navigation.mobile')}
        </figcaption>
        <div className="mx-auto flex h-[34rem] w-full max-w-[360px] flex-col overflow-hidden rounded-[2rem] border-4 border-line-strong bg-canvas lg:mx-0">
          <div className="flex flex-1 items-center justify-center p-6">
            <span className="text-2xl font-black text-ink-subtle">
              {navItems.find((item) => item.key === active)?.label}
            </span>
          </div>
          <BottomNav floating={false} items={navItems} activeKey={active} link={PreviewLink} />
        </div>
      </figure>
    </div>
  );
}

const demoTasks = [
  { id: 'one', xp: 20 },
  { id: 'two', xp: 10 },
  { id: 'three', xp: 30 },
] as const;

export function CelebrationDemo() {
  const [done, setDone] = useState<Record<string, boolean>>({ two: true });
  const completed = demoTasks.filter((task) => done[task.id]).length;
  const streak = 12 + (completed === demoTasks.length ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">{t('designSystem.celebration.hint')}</p>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
        {demoTasks.map((task) => {
          const title = t(`designSystem.celebration.tasks.${task.id}`);
          const isDone = !!done[task.id];
          return (
            <li key={task.id} className="flex items-center gap-4 px-4 py-4">
              <CompleteCheck
                checked={isDone}
                onCheckedChange={(checked) =>
                  setDone((current) => ({ ...current, [task.id]: checked }))
                }
                xp={task.xp}
                label={title}
              />
              <span
                className={cn(
                  'flex-1 font-medium transition-colors duration-(--duration-base)',
                  isDone ? 'text-ink-subtle line-through decoration-2' : 'text-ink',
                )}
              >
                {title}
              </span>
              <span className="text-xs font-bold text-accent-ink">
                {t('ui.xpGained', { xp: formatNumber(task.xp) })}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-6">
        <ProgressBar
          className="min-w-56 flex-1"
          value={completed / demoTasks.length}
          label={t('designSystem.progress.daily')}
          showValue
        />
        <span className="flex items-center gap-1.5 font-bold text-streak [&_svg]:size-5">
          <Flame aria-hidden className="fill-current" />
          {t('designSystem.progress.streakDays', { days: formatNumber(streak) })}
        </span>
      </div>
    </div>
  );
}

export function WorkDemo({ today }: { today: string }) {
  const [due, setDue] = useState<string | null>(addDays(today, 1));
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => (checked: boolean) =>
    setDone((current) => ({ ...current, [id]: checked }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="flex flex-col gap-4">
        <DatePicker
          label={t('designSystem.work.dateLabel')}
          value={due}
          onChange={setDue}
          today={today}
        />
        <TaskCard
          title={t('designSystem.work.tasks.report')}
          done={!!done.report}
          onDoneChange={toggle('report')}
          onOpen={() => undefined}
          today={today}
          dueOn={addDays(today, -2)}
          priority="urgent"
          assigneeName="سارا محمدی"
          xp={20}
          tag={
            <Badge tone="accent" size="sm">
              {t('designSystem.work.fromYesterday')}
            </Badge>
          }
        />
        <TaskCard
          title={t('designSystem.work.tasks.tickets')}
          done={!!done.tickets}
          onDoneChange={toggle('tickets')}
          today={today}
          dueOn={due}
          subtasks={{ done: 2, total: 5 }}
          commentCount={3}
          assigneeName="علی رضایی"
        />
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-2">
        <BoardColumn title={t('work.status.todo')} category="todo" count={1}>
          <TaskCard
            title={t('designSystem.work.tasks.banner')}
            done={false}
            today={today}
            dueOn={today}
            projectName={t('designSystem.work.project')}
            assigneeName="نگار کریمی"
            compact
          />
        </BoardColumn>
        <BoardColumn
          title={t('work.status.in_progress')}
          category="in_progress"
          count={1}
          highlighted
        >
          <TaskCard
            title={t('designSystem.work.tasks.review')}
            done={false}
            today={today}
            priority="high"
            assigneeName="مریم احمدی"
            dragging
            compact
          />
        </BoardColumn>
        <BoardColumn title={t('work.status.done')} category="done" count={0} />
      </div>
    </div>
  );
}

const DEMO_SOURCES: Record<string, TaskSourceInfo> = {
  audit: {
    kind: 'assigned',
    ceo: true,
    by: { id: 'ceo', displayName: 'لیلا صادقی', title: 'مدیرعامل' },
  },
  refund: {
    kind: 'assigned',
    ceo: false,
    by: { id: 'm', displayName: 'مریم احمدی', title: 'مدیر پشتیبانی' },
  },
  notes: { kind: 'request', ceo: false, by: { id: 'z', displayName: 'زهرا محمدی', title: null } },
};

/** Task sources and a personal, hand-ordered list (ADR 0017). */
export function OrderingDemo({ today }: { today: string }) {
  const [items, setItems] = useState([
    { id: 'audit', dueOn: addDays(today, 1), reasons: ['due.tomorrow', 'source.ceo'] as const },
    { id: 'refund', dueOn: today, reasons: ['due.today', 'source.assigned'] as const },
    { id: 'notes', dueOn: null, reasons: ['source.request'] as const },
  ]);
  const title = (id: string) => t(`designSystem.ordering.tasks.${id as 'audit'}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <SourceBadge source={{ kind: 'personal', ceo: false, by: null }} />
        {Object.values(DEMO_SOURCES).map((source) => (
          <SourceBadge key={source.by?.id} source={source} />
        ))}
        {DEMO_SOURCES.refund ? <SourceBadge source={DEMO_SOURCES.refund} full /> : null}
      </div>
      <p className="text-sm text-ink-muted">{t('designSystem.ordering.hint')}</p>
      <SortableList
        className="max-w-md"
        label={t('designSystem.ordering.list')}
        items={items}
        itemTitle={(item) => title(item.id)}
        onReorder={(ids) =>
          setItems((current) => ids.flatMap((id) => current.filter((i) => i.id === id)))
        }
        renderItem={(item, handle, { dragging }) => (
          <TaskCard
            title={title(item.id)}
            done={false}
            today={today}
            dueOn={item.dueOn}
            source={DEMO_SOURCES[item.id]}
            reasons={item.reasons}
            dragHandle={handle}
            dragging={dragging}
          />
        )}
      />
    </div>
  );
}

/** The progress slider, as on a task and a percentage key result (ADR 0018). */
export function SliderDemo({ today }: { today: string }) {
  const [value, setValue] = useState(50);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Slider label={t('work.progress.slider')} value={value} onChange={setValue} />
        <Slider label={t('designSystem.slider.disabled')} value={30} onChange={() => {}} disabled />
      </div>
      <TaskCard
        title={t('designSystem.slider.task')}
        done={false}
        today={today}
        dueOn={addDays(today, 2)}
        progress={value}
      />
    </div>
  );
}
