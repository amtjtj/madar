'use client';

import { ChartColumn, Flame, House, ListTodo, Settings, Target, Users } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import {
  addDays,
  formatCalendarDate,
  formatNumber,
  mentionToken,
  type ReactionEmoji,
} from '@madar/shared';
import {
  Avatar,
  CalendarDnd,
  CalendarMonth,
  DayStrip,
  DragItem,
  DropDay,
  TimedEvent,
  WeekGrid,
  LayerToggle,
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
  FileTile,
  AudienceNote,
  ConversationRow,
  DayDivider,
  EvidenceCard,
  MessageBubble,
  MentionSuggestions,
  ReactionBar,
  ReactionPicker,
  LetterRow,
  RsvpButtons,
  LiteText,
  RecipientChip,
  UploadProgress,
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

/** Conversation rows and message bubbles (ADR 0022). */
const DEMO_MARYAM = '0190a1b2-0000-7000-8000-00000000d001';
const DEMO_ALI = '0190a1b2-0000-7000-8000-00000000d002';

export function ChatDemo() {
  const maryam = t('designSystem.chat.direct');
  const ali = t('designSystem.chat.ali');
  const [mine, setMine] = useState<ReactionEmoji[]>(['👍']);
  const [active, setActive] = useState(0);
  const toggle = (emoji: ReactionEmoji, on: boolean) =>
    setMine((list) => (on ? [...list, emoji] : list.filter((e) => e !== emoji)));
  const reactions = (['👍', '🎉'] as const)
    .map((emoji) => {
      const others = emoji === '👍' ? [maryam] : [];
      const names = mine.includes(emoji) ? [...others, ali] : others;
      return { emoji, names, mine: mine.includes(emoji) };
    })
    .filter((r) => r.names.length > 0);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface p-1">
        <ConversationRow
          href="#chat"
          kind="project"
          title={t('designSystem.chat.project')}
          preview={t('designSystem.chat.projectPreview')}
          time={t('designSystem.chat.time2')}
          unread={3}
          mentioned
        />
        <ConversationRow
          href="#chat"
          kind="direct"
          title={t('designSystem.chat.direct')}
          preview={t('designSystem.chat.directPreview')}
          time={t('designSystem.chat.time1')}
          unread={0}
          muted
        />
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-canvas p-3">
        <DayDivider label={t('designSystem.chat.today')} />
        <MessageBubble
          mine={false}
          author={t('designSystem.chat.direct')}
          body={t('designSystem.chat.first')}
          time={t('designSystem.chat.time1')}
        />
        <MessageBubble
          mine
          body={t('designSystem.chat.second')}
          time={t('designSystem.chat.time2')}
          edited
          replyTo={{
            author: t('designSystem.chat.direct'),
            body: t('designSystem.chat.reply'),
            deleted: false,
          }}
        />
        <MessageBubble mine body="" time={t('designSystem.chat.time2')} deleted />
        <MessageBubble
          mine={false}
          author={maryam}
          body={`${mentionToken(DEMO_ALI)} ${t('designSystem.chat.mentionBody')}`}
          mentions={[{ id: DEMO_ALI, displayName: ali }]}
          meId={DEMO_ALI}
          time={t('designSystem.chat.time2')}
          reactions={<ReactionBar reactions={reactions} onToggle={toggle} />}
        />
        <ReactionPicker mine={mine} onPick={toggle} className="self-start" />
      </div>
      <div className="flex flex-col gap-1">
        <MentionSuggestions
          id="demo-mentions"
          people={[
            { id: DEMO_MARYAM, displayName: maryam },
            { id: DEMO_ALI, displayName: ali },
          ]}
          activeIndex={active}
          onPick={(p) => setActive(p.id === DEMO_ALI ? 1 : 0)}
        />
      </div>
    </div>
  );
}

export function LettersDemo() {
  const [chips, setChips] = useState([
    t('designSystem.letters.sender'),
    t('designSystem.letters.sender2'),
  ]);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface p-1">
        <LetterRow
          href="#letters"
          person={t('designSystem.letters.sender')}
          subject={t('designSystem.letters.subject')}
          preview={t('designSystem.letters.preview')}
          number="1405/00042"
          date={t('designSystem.letters.date')}
          urgency="urgent"
          confidential={false}
          attachmentCount={1}
          unread
        />
        <LetterRow
          href="#letters"
          person={t('designSystem.letters.sender2')}
          subject={t('designSystem.letters.subject2')}
          number="1405/00039"
          date={t('designSystem.letters.date2')}
          urgency="immediate"
          confidential
          attachmentCount={0}
          tag={t('designSystem.letters.referral')}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((name) => (
          <RecipientChip
            key={name}
            name={name}
            onRemove={() => setChips((all) => all.filter((n) => n !== name))}
          />
        ))}
        <RecipientChip name={t('designSystem.letters.sender')} read />
        <RecipientChip
          name={t('designSystem.letters.sender2')}
          read={false}
          note={t('designSystem.letters.cc')}
        />
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <LiteText text={t('designSystem.letters.body')} />
      </div>
      <EvidenceCard
        summary={{
          subject: t('designSystem.letters.subject'),
          number: '1405/00042',
          sender: { id: 'a', displayName: t('designSystem.letters.sender') },
          to: [{ id: 'b', displayName: t('designSystem.letters.sender2') }],
          date: new Date().toISOString(),
          urgency: 'urgent',
          read: false,
          attachmentCount: 1,
        }}
        date={t('designSystem.letters.date')}
        onOpen={() => {}}
        onUnpin={() => {}}
      />
      <AudienceNote
        audience={{
          people: [{ id: 'b', displayName: t('designSystem.letters.sender2'), role: 'reporter' }],
          groups: [
            { kind: 'department', name: t('designSystem.charts.dept1') },
            { kind: 'company_readers', name: null },
          ],
        }}
      />
    </div>
  );
}

/** Attached files and an upload on its way (ADR 0019). */
export function FilesDemo() {
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <FileTile
        fileName={t('designSystem.files.pdf')}
        size={2_400_000}
        kind="pdf"
        meta={t('designSystem.files.meta')}
      />
      <FileTile
        fileName={t('designSystem.files.sheet')}
        size={84_000}
        kind="document"
        meta={t('designSystem.files.meta')}
      />
      <UploadProgress fileName={t('designSystem.files.image')} progress={0.6} onCancel={() => {}} />
    </div>
  );
}

export function RsvpDemo() {
  const [value, setValue] = useState<'pending' | 'accepted' | 'declined'>('pending');
  return <RsvpButtons value={value} onChange={setValue} className="max-w-sm" />;
}

export function CalendarDemo({ today }: { today: string }) {
  const [selected, setSelected] = useState<string | null>(today);
  const [layers, setLayers] = useState({ meeting: true, task: true });
  const start = addDays(today, -10);
  const cells = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(start, i);
    const items = [
      ...(layers.meeting && i % 3 === 0
        ? [{ layer: 'meeting' as const, title: t('designSystem.calendar.meeting') }]
        : []),
      ...(layers.task && i % 2 === 0
        ? [{ layer: 'task' as const, title: t('designSystem.calendar.task') }]
        : []),
      ...(i === 10
        ? [{ layer: 'project' as const, title: t('designSystem.calendar.project') }]
        : []),
    ];
    return { date, inMonth: true, today: date === today, off: i % 7 === 6, items };
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-sm rounded-2xl border border-line bg-surface p-1">
        <LayerToggle
          layer="meeting"
          label={t('calendar.layers.meetings')}
          checked={layers.meeting}
          onChange={(meeting) => setLayers({ ...layers, meeting })}
        />
        <LayerToggle
          layer="task"
          label={t('calendar.layers.tasks')}
          checked={layers.task}
          onChange={(task) => setLayers({ ...layers, task })}
        />
      </div>
      <CalendarMonth
        cells={cells}
        selected={selected}
        onSelect={setSelected}
        dayLabel={(cell) =>
          t('designSystem.calendar.dayLabel', {
            day: formatCalendarDate(cell.date, 'full'),
            count: formatNumber(cell.items.length),
          })
        }
      />
    </div>
  );
}

export function WeekDemo({ today }: { today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 3);
    return { date, today: date === today, off: i === 6 };
  });
  const [due, setDue] = useState(addDays(today, -1));
  const [selected, setSelected] = useState(today);
  const meeting = (
    id: string,
    title: string,
    start: number,
    end: number,
    column = 0,
    columns = 1,
  ) => ({
    id,
    date: today,
    start,
    end,
    column,
    columns,
    node: <TimedEvent title={title} time={t('designSystem.calendar.time')} href="#calendar" />,
  });
  const chip = (
    <DragItem id="demo-task" title={t('designSystem.calendar.task')}>
      {(handle) => (
        <div className="flex min-w-0 items-center rounded-md bg-layer-task-soft text-[0.6875rem] leading-5 text-ink">
          {handle}
          <span className="truncate px-1">{t('designSystem.calendar.task')}</span>
        </div>
      )}
    </DragItem>
  );
  return (
    <CalendarDnd
      onMove={(_id, date) => setDue(date)}
      itemTitle={() => t('designSystem.calendar.task')}
      dayLabel={(date) => formatCalendarDate(date, 'full')}
    >
      <div className="flex flex-col gap-4">
        <DayStrip
          label={t('calendar.weekDays')}
          selected={selected}
          onSelect={setSelected}
          days={days.map((d) => ({ ...d, busy: d.date === due || d.today }))}
          dayLabel={(d) => formatCalendarDate(d.date, 'full')}
        />
        <WeekGrid
          days={days}
          startHour={9}
          endHour={14}
          nowMinutes={11 * 60 + 20}
          dayLabel={(d) => formatCalendarDate(d.date, 'full')}
          allDay={(d) => (
            <DropDay date={d.date} className="h-full p-1">
              {d.date === due && chip}
            </DropDay>
          )}
          events={[
            meeting('a', t('designSystem.calendar.meeting'), 600, 660, 0, 2),
            meeting('b', t('designSystem.meetings.okr'), 630, 720, 1, 2),
          ]}
        />
      </div>
    </CalendarDnd>
  );
}
