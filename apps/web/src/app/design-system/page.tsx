import { Award, Flame, HeartHandshake, Plus, Rocket, Search, Sparkles, Ticket } from 'lucide-react';
import type { Metadata } from 'next';

import { t } from '@madar/i18n';
import {
  addDays,
  calendarDateIn,
  formatJalaliDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
  toPersianDigits,
} from '@madar/shared';
import {
  AchievementBadge,
  Avatar,
  AvatarGroup,
  AnswerCard,
  AssistantBadge,
  AssistantThinking,
  DraftCard,
  LiteText,
  SourceList,
  Badge,
  CalendarItemRow,
  BarList,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ColumnChart,
  EmptyState,
  ProgressBar,
  ProgressRing,
  Skeleton,
  SkeletonText,
  StackedBarList,
  StatTile,
  TextField,
  ThemeToggle,
  cn,
  AmountText,
  ApprovalTimeline,
  BadgeGrid,
  KudosCard,
  LevelBar,
  LevelUpMark,
  StreakFlame,
  StreakMap,
  XpRow,
  DecisionItem,
  MeetingRow,
  RequestKindBadge,
  RequestRow,
  RequestStatusBadge,
  MeetingTypeBadge,
  MinutesEvidenceCard,
  ResponseBadge,
} from '@madar/ui';

import {
  CelebrationDemo,
  FeedbackDemo,
  NavigationDemo,
  OrderingDemo,
  SliderDemo,
  FilesDemo,
  LettersDemo,
  RsvpDemo,
  ChatDemo,
  WorkDemo,
  CalendarDemo,
  SuggestionDemo,
  WeekDemo,
  ValueTagDemo,
} from './interactive';
import { Code, Panel, Section } from './section';

export const metadata: Metadata = { title: t('designSystem.title') };

// Dates on this page are relative to the request time.
export const dynamic = 'force-dynamic';

const colorGroups = [
  { key: 'surfaces', tokens: ['canvas', 'surface', 'sunken', 'overlay'] },
  { key: 'ink', tokens: ['ink', 'ink-muted', 'ink-subtle', 'line', 'line-strong'] },
  {
    key: 'brand',
    tokens: ['primary', 'primary-soft', 'accent', 'accent-soft', 'streak', 'streak-soft'],
  },
  { key: 'status', tokens: ['success', 'warning', 'danger', 'info', 'danger-soft', 'info-soft'] },
] as const;

const people = ['maryam', 'reza', 'sara', 'ali', 'nima', 'zahra'] as const;

export default function DesignSystemPage() {
  const now = new Date();
  const name = (key: (typeof people)[number]) => t(`designSystem.people.${key}`);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-xl font-black text-ink sm:text-2xl">{t('designSystem.title')}</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-8 sm:py-12">
        <p className="max-w-2xl text-lg text-ink-muted">{t('designSystem.intro')}</p>

        {/* ---------- Colors ---------- */}
        <Section id="colors" title={t('designSystem.sections.colors')}>
          <div className="grid gap-4 md:grid-cols-2">
            {colorGroups.map((group) => (
              <Panel key={group.key} className="flex flex-col gap-3">
                <h3 className="font-bold text-ink">{t(`designSystem.colorGroups.${group.key}`)}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {group.tokens.map((token) => (
                    <div key={token} className="flex flex-col gap-1.5">
                      <div
                        className="h-14 rounded-lg border border-line"
                        style={{ background: `var(--${token})` }}
                      />
                      <Code>--{token}</Code>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        </Section>

        {/* ---------- Typography ---------- */}
        <Section id="typography" title={t('designSystem.sections.typography')}>
          <Panel className="flex flex-col gap-5">
            {(
              [
                ['display', 'text-4xl font-black'],
                ['title', 'text-2xl font-extrabold'],
                ['heading', 'text-lg font-bold'],
                ['body', 'text-base'],
                ['caption', 'text-sm text-ink-muted'],
              ] as const
            ).map(([key, classes]) => (
              <div key={key} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="w-20 shrink-0 text-xs font-semibold text-ink-subtle">
                  {t(`designSystem.typeScale.${key}`)}
                </span>
                <p className={cn('text-ink', classes)}>{t('designSystem.typeSample')}</p>
              </div>
            ))}
          </Panel>
        </Section>

        {/* ---------- Shape ---------- */}
        <Section id="shape" title={t('designSystem.sections.shape')}>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="flex flex-col gap-3">
              <h3 className="font-bold text-ink">{t('designSystem.shape.radius')}</h3>
              <div className="flex flex-wrap gap-3">
                {(['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((r) => (
                  <div key={r} className="flex flex-col items-center gap-1">
                    <div
                      className="size-14 border-2 border-primary bg-primary-soft"
                      style={{ borderRadius: `var(--radius-${r})` }}
                    />
                    <Code>{r}</Code>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel className="flex flex-col gap-3">
              <h3 className="font-bold text-ink">{t('designSystem.shape.shadow')}</h3>
              <div className="flex flex-wrap gap-4 bg-canvas p-3">
                {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
                  <div key={s} className="flex flex-col items-center gap-2">
                    <div
                      className="size-14 rounded-lg bg-surface"
                      style={{ boxShadow: `var(--shadow-${s})` }}
                    />
                    <Code>{s}</Code>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel className="flex flex-col gap-3">
              <h3 className="font-bold text-ink">{t('designSystem.shape.spacing')}</h3>
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4, 6, 8, 12].map((step) => (
                  <div key={step} className="flex items-center gap-3">
                    <span className="w-14 text-xs text-ink-subtle tabular-nums">
                      {toPersianDigits(step * 4)}px
                    </span>
                    <div className="h-3 rounded-full bg-accent" style={{ width: step * 4 * 2 }} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </Section>

        {/* ---------- Buttons ---------- */}
        <Section id="buttons" title={t('designSystem.sections.buttons')}>
          <Panel className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button>{t('designSystem.buttons.primary')}</Button>
              <Button variant="secondary">{t('designSystem.buttons.secondary')}</Button>
              <Button variant="ghost">{t('designSystem.buttons.ghost')}</Button>
              <Button variant="danger">{t('designSystem.buttons.danger')}</Button>
              <Button variant="accent" icon={<Sparkles aria-hidden />}>
                {t('designSystem.buttons.accent')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">{t('designSystem.buttons.small')}</Button>
              <Button size="lg" icon={<Plus aria-hidden />}>
                {t('designSystem.buttons.withIcon')}
              </Button>
              <Button loading>{t('designSystem.buttons.loading')}</Button>
              <Button disabled>{t('designSystem.buttons.disabled')}</Button>
              <Button
                size="icon"
                variant="secondary"
                aria-label={t('designSystem.buttons.withIcon')}
              >
                <Plus aria-hidden />
              </Button>
            </div>
          </Panel>
        </Section>

        {/* ---------- Inputs ---------- */}
        <Section id="inputs" title={t('designSystem.sections.inputs')}>
          <Panel className="grid gap-5 md:grid-cols-2">
            <TextField
              label={t('designSystem.inputs.titleLabel')}
              placeholder={t('designSystem.inputs.titlePlaceholder')}
              hint={t('designSystem.inputs.titleHint')}
              required
            />
            <TextField
              label={t('designSystem.inputs.usernameLabel')}
              defaultValue="maryam.ahmadi"
              dir="ltr"
              error={t('designSystem.inputs.usernameError')}
            />
            <TextField
              label={t('designSystem.inputs.searchPlaceholder')}
              hideLabel
              placeholder={t('designSystem.inputs.searchPlaceholder')}
              icon={<Search aria-hidden />}
              type="search"
            />
            <TextField
              label={t('designSystem.inputs.amountLabel')}
              inputMode="numeric"
              defaultValue={formatNumber(12500000)}
              disabled
            />
          </Panel>
        </Section>

        {/* ---------- Cards ---------- */}
        <Section id="cards" title={t('designSystem.sections.cards')}>
          <div className="grid gap-4 md:grid-cols-3">
            <Card interactive>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="info" dot>
                    {t('designSystem.badges.inProgress')}
                  </Badge>
                  <Badge tone="danger">{t('designSystem.badges.urgent')}</Badge>
                </div>
                <CardTitle className="mt-2">{t('designSystem.cards.taskTitle')}</CardTitle>
                <CardDescription>{t('designSystem.cards.taskMeta')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ProgressBar value={0.6} size="sm" />
              </CardContent>
              <CardFooter className="justify-between">
                <AvatarGroup
                  people={people.slice(0, 3).map((p) => ({ name: name(p) }))}
                  size="xs"
                />
                <span className="text-xs font-bold text-accent-ink">
                  {t('ui.xpGained', { xp: formatNumber(30) })}
                </span>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('designSystem.cards.goalTitle')}</CardTitle>
                <CardDescription>{t('designSystem.cards.goalBody')}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <ProgressRing value={0.68} label={t('designSystem.progress.quarter')} />
                <Button variant="secondary" size="sm">
                  {t('designSystem.cards.open')}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>{t('designSystem.cards.metricLabel')}</CardDescription>
                <p className="text-4xl font-black text-ink tabular-nums">{formatNumber(42)}</p>
              </CardHeader>
              <CardContent>
                <Badge tone="success">{t('designSystem.cards.metricDelta')}</Badge>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ---------- Progress ---------- */}
        <Section id="progress" title={t('designSystem.sections.progress')}>
          <Panel className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-5">
              <ProgressBar
                value={0.7}
                label={t('designSystem.progress.daily')}
                showValue
                size="lg"
              />
              <ProgressBar
                value={0.45}
                label={t('designSystem.progress.weekly')}
                showValue
                tone="info"
              />
              <ProgressBar
                value={0.82}
                label={t('designSystem.progress.level', { level: formatNumber(7) })}
                showValue
                tone="accent"
              />
            </div>
            <div className="flex items-center justify-center gap-5">
              <ProgressRing value={0.68} label={t('designSystem.progress.quarter')} />
              <ProgressRing value={1} tone="streak" label={t('designSystem.progress.streak')}>
                <Flame aria-hidden className="size-7 fill-streak text-streak" />
              </ProgressRing>
            </div>
          </Panel>
        </Section>

        {/* ---------- Avatars ---------- */}
        <Section id="avatars" title={t('designSystem.sections.avatars')}>
          <Panel className="flex flex-wrap items-end gap-5">
            <Avatar name={name('maryam')} size="xl" status="online" />
            <Avatar name={name('reza')} size="lg" status="away" />
            <Avatar name={name('sara')} size="md" status="offline" />
            <Avatar name={name('ali')} size="sm" />
            <Avatar name={name('nima')} size="xs" />
            <AvatarGroup people={people.map((p) => ({ name: name(p) }))} max={4} size="md" />
          </Panel>
        </Section>

        {/* ---------- Badges ---------- */}
        <Section id="badges" title={t('designSystem.sections.badges')}>
          <Panel className="flex flex-col gap-6">
            <div className="flex flex-wrap gap-2">
              <Badge>{t('designSystem.badges.todo')}</Badge>
              <Badge tone="info" dot>
                {t('designSystem.badges.inProgress')}
              </Badge>
              <Badge tone="warning" dot>
                {t('designSystem.badges.review')}
              </Badge>
              <Badge tone="success" dot>
                {t('designSystem.badges.done')}
              </Badge>
              <Badge tone="danger" dot>
                {t('designSystem.badges.blocked')}
              </Badge>
              <Badge tone="primary">{t('designSystem.badges.new')}</Badge>
              <Badge tone="accent" size="md">
                {t('ui.xpGained', { xp: formatNumber(50) })}
              </Badge>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="font-bold text-ink">{t('designSystem.badges.achievements')}</h3>
              <div className="flex flex-wrap gap-4">
                <AchievementBadge
                  label={t('designSystem.badges.firstTask')}
                  icon={<Rocket aria-hidden />}
                  tier="bronze"
                />
                <AchievementBadge
                  label={t('designSystem.badges.helper')}
                  icon={<HeartHandshake aria-hidden />}
                  tier="silver"
                />
                <AchievementBadge
                  label={t('designSystem.badges.hundredTickets')}
                  icon={<Ticket aria-hidden />}
                  tier="gold"
                />
                <AchievementBadge
                  label={t('designSystem.badges.streak30')}
                  icon={<Award aria-hidden />}
                  locked
                />
              </div>
            </div>
          </Panel>
        </Section>

        {/* ---------- Skeleton & empty ---------- */}
        <div className="grid gap-14 md:grid-cols-2 md:gap-6">
          <Section id="skeleton" title={t('designSystem.sections.skeleton')}>
            <Panel className="flex flex-col gap-5">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <SkeletonText lines={2} className="flex-1" />
                </div>
              ))}
              <Skeleton className="h-24 w-full rounded-xl" />
            </Panel>
          </Section>
          <Section id="empty" title={t('designSystem.sections.empty')}>
            <Panel className="p-0">
              <EmptyState
                title={t('designSystem.empty.title')}
                description={t('designSystem.empty.description')}
                action={
                  <Button icon={<Plus aria-hidden />}>{t('designSystem.empty.action')}</Button>
                }
              />
            </Panel>
          </Section>
        </div>

        {/* ---------- Feedback ---------- */}
        <Section id="feedback" title={t('designSystem.sections.feedback')}>
          <Panel>
            <FeedbackDemo />
          </Panel>
        </Section>

        {/* ---------- Celebration ---------- */}
        <Section id="celebration" title={t('designSystem.sections.celebration')}>
          <Panel>
            <CelebrationDemo />
          </Panel>
        </Section>

        {/* ---------- Work ---------- */}
        <Section id="work" title={t('designSystem.sections.work')}>
          <Panel>
            <WorkDemo today={calendarDateIn(new Date())} />
          </Panel>
        </Section>

        <Section id="ordering" title={t('designSystem.sections.ordering')}>
          <Panel>
            <OrderingDemo today={calendarDateIn(new Date())} />
          </Panel>
        </Section>

        <Section id="files" title={t('designSystem.sections.files')}>
          <Panel>
            <FilesDemo />
          </Panel>
        </Section>

        <Section id="chat" title={t('designSystem.sections.chat')}>
          <Panel>
            <ChatDemo />
          </Panel>
        </Section>

        <Section id="letters" title={t('designSystem.sections.letters')}>
          <Panel>
            <LettersDemo />
          </Panel>
        </Section>

        <Section id="requests" title={t('designSystem.sections.requests')}>
          <Panel>
            <div className="flex max-w-xl flex-col gap-4">
              <div className="divide-y divide-line rounded-2xl border border-line bg-surface p-1">
                <RequestRow
                  href="#requests"
                  kind="leave"
                  title={t('designSystem.requests.leave')}
                  status="pending"
                  person={t('designSystem.requests.person')}
                  when={t('designSystem.requests.when')}
                />
                <RequestRow
                  href="#requests"
                  kind="expense"
                  title={t('designSystem.requests.expense')}
                  status="approved"
                  person={t('designSystem.requests.person')}
                  when={t('designSystem.requests.when')}
                  amountToman={18_000_000}
                />
                <RequestRow
                  href="#requests"
                  kind="general"
                  title={t('designSystem.requests.general')}
                  status="rejected"
                  when={t('designSystem.requests.when')}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <RequestKindBadge kind="leave" />
                <RequestKindBadge kind="expense" />
                <RequestKindBadge kind="general" />
                <RequestStatusBadge status="pending" />
                <RequestStatusBadge status="canceled" />
                <AmountText toman={1_250_000} />
              </div>
              <ApprovalTimeline
                steps={[
                  {
                    approver: t('designSystem.requests.boss'),
                    decision: 'approved',
                    comment: t('designSystem.requests.comment'),
                    when: t('designSystem.requests.stamp'),
                  },
                  { approver: t('designSystem.requests.ceo'), decision: null, current: true },
                ]}
              />
            </div>
          </Panel>
        </Section>

        <Section id="gamification" title={t('designSystem.sections.gamification')}>
          <Panel>
            <GamificationDemo />
          </Panel>
        </Section>

        <Section id="meetings" title={t('designSystem.sections.meetings')}>
          <Panel>
            <div className="flex max-w-xl flex-col gap-4">
              <div className="divide-y divide-line rounded-2xl border border-line bg-surface p-1">
                <MeetingRow
                  href="#meetings"
                  title={t('designSystem.meetings.title')}
                  type="regular"
                  time={t('designSystem.meetings.time')}
                  participantCount={4}
                  hasMinutes={false}
                  canceled={false}
                  live
                />
                <MeetingRow
                  href="#meetings"
                  title={t('designSystem.meetings.okr')}
                  type="okr_review"
                  time={t('designSystem.meetings.time2')}
                  participantCount={6}
                  hasMinutes
                  canceled={false}
                  weekly
                />
                <MeetingRow
                  href="#meetings"
                  title={t('designSystem.meetings.canceled')}
                  type="one_on_one"
                  time={t('designSystem.meetings.time3')}
                  participantCount={2}
                  hasMinutes={false}
                  canceled
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <MeetingTypeBadge type="regular" />
                <MeetingTypeBadge type="okr_review" />
                <MeetingTypeBadge type="one_on_one" />
              </div>
              <DecisionItem
                text={t('designSystem.meetings.decision')}
                keyResult={t('designSystem.meetings.keyResult')}
                task={{
                  title: t('designSystem.meetings.task'),
                  assignee: t('designSystem.meetings.assignee'),
                  href: '#meetings',
                }}
              />
              <DecisionItem text={t('designSystem.meetings.decision2')} />
              <RsvpDemo />
              <div className="flex flex-wrap gap-2">
                <ResponseBadge response="accepted" />
                <ResponseBadge response="declined" />
                <ResponseBadge response="pending" />
              </div>
              <MinutesEvidenceCard
                minutes={{
                  meeting: { title: t('designSystem.meetings.okr'), type: 'okr_review' },
                  date: '2026-10-24T05:30:00.000Z',
                  excerpt: t('designSystem.meetings.minutesExcerpt'),
                  attachmentCount: 1,
                }}
                date={t('designSystem.meetings.minutesDate')}
              />
            </div>
          </Panel>
        </Section>

        <Section id="calendar" title={t('designSystem.sections.calendar')}>
          <Panel>
            <div className="flex flex-col gap-4">
              <div className="max-w-xl divide-y divide-line rounded-2xl border border-line bg-surface p-1">
                <CalendarItemRow
                  href="#calendar"
                  layer="meeting"
                  title={t('designSystem.calendar.meeting')}
                  time={t('designSystem.calendar.time')}
                />
                <CalendarItemRow
                  href="#calendar"
                  layer="task"
                  title={t('designSystem.calendar.task')}
                  tags={<Badge tone="danger">{t('calendar.overdueTag')}</Badge>}
                />
                <CalendarItemRow
                  href="#calendar"
                  layer="plan"
                  title={t('designSystem.calendar.plan')}
                  tags={<Badge tone="success">{t('calendar.plannedTag')}</Badge>}
                />
                <CalendarItemRow
                  href="#calendar"
                  layer="project"
                  title={t('designSystem.calendar.project')}
                />
                <CalendarItemRow
                  href="#calendar"
                  layer="period"
                  title={t('designSystem.calendar.period')}
                />
              </div>
              <CalendarDemo today={calendarDateIn(new Date())} />
              <WeekDemo today={calendarDateIn(new Date())} />
            </div>
          </Panel>
        </Section>

        <Section id="assistant" title={t('designSystem.sections.assistant')}>
          <Panel>
            <div className="flex max-w-xl flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-ink">{t('assistant.summaryTitle')}</span>
                  <AssistantBadge />
                </div>
                <p className="leading-8 text-ink">{t('designSystem.assistant.summary')}</p>
              </div>
              <AssistantThinking />
              <AnswerCard text={t('designSystem.assistant.answer')} idPrefix="demo-source">
                <SourceList
                  idPrefix="demo-source"
                  items={[
                    {
                      n: 1,
                      kind: 'meeting',
                      title: t('designSystem.assistant.source1'),
                      href: '#assistant',
                      cited: true,
                    },
                    {
                      n: 2,
                      kind: 'task',
                      title: t('designSystem.assistant.source2'),
                      href: '#assistant',
                      cited: true,
                    },
                    {
                      n: 3,
                      kind: 'letter',
                      title: t('designSystem.assistant.source3'),
                      href: '#assistant',
                      cited: false,
                    },
                  ]}
                />
              </AnswerCard>
              <DraftCard
                title={t('assistant.minutes.draftTitle')}
                actions={
                  <>
                    <Button size="sm">{t('assistant.minutes.replace')}</Button>
                    <Button variant="ghost" size="sm">
                      {t('assistant.minutes.discard')}
                    </Button>
                  </>
                }
              >
                <LiteText text={t('designSystem.assistant.minutes')} />
              </DraftCard>
              <SuggestionDemo today={calendarDateIn(new Date())} />
            </div>
          </Panel>
        </Section>

        <Section id="slider" title={t('designSystem.sections.slider')}>
          <Panel>
            <SliderDemo today={calendarDateIn(new Date())} />
          </Panel>
        </Section>

        {/* ---------- Navigation ---------- */}
        <Section id="charts" title={t('designSystem.sections.charts')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel>
              <StatTile
                label={t('designSystem.charts.stat')}
                value={formatPercent(0.42)}
                hint={t('designSystem.charts.statHint')}
              />
            </Panel>
            <Panel>
              <BarList
                title={t('designSystem.charts.overdue')}
                tone="danger"
                items={[
                  { key: '1', label: t('designSystem.charts.dept1'), value: 7 },
                  { key: '2', label: t('designSystem.charts.dept2'), value: 3 },
                  { key: '3', label: t('designSystem.charts.dept3'), value: 0 },
                ]}
              />
            </Panel>
            <Panel>
              <ColumnChart
                title={t('designSystem.charts.weekly')}
                points={[12, 18, 15, 22, 19, 25, 21, 28].map((value, i) => ({
                  key: String(i),
                  label: t('designSystem.charts.week', { n: formatNumber(i + 1) }),
                  value,
                }))}
              />
            </Panel>
            <Panel>
              <StackedBarList
                title={t('designSystem.charts.workload')}
                series={[
                  { key: 'todo', label: t('designSystem.charts.todo'), fill: 'bg-chart-2' },
                  { key: 'doing', label: t('designSystem.charts.inProgress'), fill: 'bg-chart-1' },
                ]}
                rows={[
                  { key: '1', label: t('designSystem.charts.person1'), values: [4, 2] },
                  { key: '2', label: t('designSystem.charts.person2'), values: [2, 3] },
                ]}
              />
            </Panel>
          </div>
        </Section>

        <Section id="navigation" title={t('designSystem.sections.navigation')}>
          <NavigationDemo />
        </Section>

        {/* ---------- Locale ---------- */}
        <Section id="locale" title={t('designSystem.sections.locale')}>
          <Panel>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {(
                [
                  ['full', formatJalaliDate(now, 'full')],
                  ['long', formatJalaliDate(now, 'long')],
                  ['medium', formatJalaliDate(now, 'medium')],
                  ['short', formatJalaliDate(now, 'short')],
                  ['time', formatTime(now)],
                  [
                    'relative',
                    `${formatRelativeTime(new Date(now.getTime() - 3 * 3600_000), now)} · ${formatRelativeTime(new Date(now.getTime() + 86_400_000), now)}`,
                  ],
                  ['number', formatNumber(1234567.89)],
                  ['percent', formatPercent(0.725, 1)],
                  ['digits', `0912 345 6789 → ${toPersianDigits('0912 345 6789')}`],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-0.5 border-b border-line pb-3">
                  <dt className="text-xs font-semibold text-ink-subtle">
                    {t(`designSystem.locale.${key}`)}
                  </dt>
                  <dd className="text-lg font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </Section>

        {/* ---------- Theme comparison ---------- */}
        <Section id="themes" title={t('designSystem.sections.themes')}>
          <div className="grid gap-4 md:grid-cols-2">
            {(['light', 'dark'] as const).map((theme) => (
              <div
                key={theme}
                data-theme={theme}
                className="flex flex-col gap-4 rounded-2xl border border-line bg-canvas p-5 text-ink"
              >
                <Badge tone="neutral" className="self-start">
                  {t(`theme.${theme}`)}
                </Badge>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('designSystem.cards.taskTitle')}</CardTitle>
                    <CardDescription>{t('designSystem.cards.taskMeta')}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <ProgressBar value={0.7} label={t('designSystem.progress.daily')} showValue />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm">{t('designSystem.buttons.primary')}</Button>
                      <Button size="sm" variant="secondary">
                        {t('designSystem.buttons.secondary')}
                      </Button>
                      <Button size="sm" variant="accent">
                        {t('designSystem.buttons.accent')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}

function GamificationDemo() {
  const to = '2026-10-23';
  const from = addDays(to, -27);
  const statuses = [
    'completed',
    'completed',
    'missed',
    'completed',
    'excused_leave',
    'off_day',
    'completed',
  ] as const;
  const days = Array.from({ length: 28 }, (_, i) => ({
    day: addDays(from, i),
    status: statuses[i % statuses.length] ?? 'completed',
  }));
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex items-center gap-6">
        <StreakFlame count={6} />
        <StreakFlame count={0} />
        <StreakFlame count={12} size="lg" />
      </div>
      <LevelBar level={4} into={420} span={400 + 400} />
      <StreakMap days={days} from={from} to={to} />
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface px-3">
        <XpRow
          amount={30}
          reason="task_completed"
          title={t('designSystem.gamification.task')}
          weight={3}
          when={t('designSystem.gamification.when')}
        />
        <XpRow
          amount={15}
          reason="on_time"
          title={t('designSystem.gamification.task')}
          weight={3}
          when={t('designSystem.gamification.when')}
        />
        <XpRow amount={-45} reason="reversal" when={t('designSystem.gamification.when')} />
      </div>
      <LevelUpMark />
      <KudosCard
        from={t('designSystem.requests.person')}
        to={t('designSystem.requests.boss')}
        tag="teamwork"
        message={t('designSystem.gamification.kudos')}
        taskTitle={t('designSystem.gamification.task')}
        when={t('designSystem.gamification.when')}
      />
      <ValueTagDemo />
      <BadgeGrid
        items={[
          { key: 'first_task', tier: 'bronze', earned: true },
          { key: 'tasks_50', tier: 'silver', earned: false, value: 32, goal: 50 },
          { key: 'streak_60', tier: 'gold', earned: false, value: 9, goal: 60 },
        ]}
      />
    </div>
  );
}
