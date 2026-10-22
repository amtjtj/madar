'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  MEETING_AGENDA_MAX,
  MEETING_TITLE_MAX,
  MEETING_TYPES,
  calendarDateIn,
  toPersianDigits,
  type Meeting,
  type MeetingType,
} from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  DatePicker,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { RecipientPicker, type Person } from '@/components/letters/recipient-picker';
import { useMeeting, useSaveMeeting } from '@/hooks/meetings';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';
import { defaultSlot, meetingInstants, wallClock } from '@/lib/meetings';

import { LiteField } from './lite-field';

/** «جلسه تازه», or «ویرایش جلسه» with `?edit=<id>` (the organizer only). */
export function MeetingFormPage() {
  const editId = useSearchParams().get('edit') ?? undefined;
  const { data: meeting, isPending } = useMeeting(editId);
  const { data: me } = useMe();
  if (!me || (editId && isPending)) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <MeetingForm
      meeting={editId ? meeting : undefined}
      memberId={me.member?.id}
      timeZone={me.tenant?.timezone}
    />
  );
}

/** Every quarter hour, in Persian digits; an odd saved time stays selectable. */
function timeOptions(current: string) {
  const times = Array.from({ length: 96 }, (_, i) => {
    const h = String(Math.floor(i / 4)).padStart(2, '0');
    return `${h}:${String((i % 4) * 15).padStart(2, '0')}`;
  });
  if (!times.includes(current)) times.push(current);
  return times.sort().map((value) => ({ value, label: toPersianDigits(value) }));
}

function MeetingForm({
  meeting,
  memberId,
  timeZone,
}: {
  meeting?: Meeting;
  memberId?: string;
  timeZone?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const save = useSaveMeeting();
  const slot = meeting
    ? {
        date: calendarDateIn(new Date(meeting.startsAt), timeZone),
        start: wallClock(new Date(meeting.startsAt), timeZone),
        end: wallClock(new Date(meeting.endsAt), timeZone),
      }
    : defaultSlot(timeZone);
  const [type, setType] = useState<MeetingType>(meeting?.type ?? 'regular');
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [date, setDate] = useState(slot.date);
  const [start, setStart] = useState(slot.start);
  const [end, setEnd] = useState(slot.end);
  const [people, setPeople] = useState<Person[]>(
    meeting?.participants.filter((p) => p.id !== meeting.organizer.id) ?? [],
  );
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [link, setLink] = useState(meeting?.link ?? '');
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '');
  const [problem, setProblem] = useState('');
  const oneOnOne = type === 'one_on_one';
  const today = calendarDateIn(new Date(), timeZone);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setProblem(t('meetings.form.needsTitle'));
    if (oneOnOne && people.length !== 1) return setProblem(t('meetings.form.needsOne'));
    const when = meetingInstants({ date, start, end, link }, timeZone);
    if ('error' in when) return setProblem(when.error);
    setProblem('');
    const fields = {
      title: title.trim(),
      ...when,
      location: location.trim() || null,
      link: link.trim() || null,
      agenda,
      participantIds: people.map((p) => p.id),
    };
    save.mutate(
      { id: meeting?.id, body: meeting ? fields : { type, ...fields } },
      {
        onSuccess: (saved) => {
          toast({
            tone: 'success',
            title: meeting ? t('meetings.form.saved') : t('meetings.form.created'),
          });
          router.push(`/meetings/${saved.id}`);
        },
        onError: (error) => setProblem(errorMessage(error)),
      },
    );
  };

  return (
    <>
      <PageHeader title={meeting ? t('meetings.form.editTitle') : t('meetings.form.newTitle')} />
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <TextField
              label={t('meetings.form.title')}
              placeholder={t('meetings.form.titlePlaceholder')}
              value={title}
              maxLength={MEETING_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={!meeting}
            />
            {!meeting && (
              <SelectField
                label={t('meetings.form.type')}
                hint={t(`meetings.form.typeHints.${type}`)}
                value={type}
                onChange={(e) => {
                  const next = e.target.value as MeetingType;
                  setType(next);
                  if (next === 'one_on_one') setPeople((list) => list.slice(-1));
                }}
                options={MEETING_TYPES.map((value) => ({
                  value,
                  label: t(`meetings.types.${value}`),
                }))}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <DatePicker
                label={t('meetings.form.date')}
                value={date}
                onChange={(next) => next && setDate(next)}
                today={today}
              />
              <SelectField
                label={t('meetings.form.start')}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                options={timeOptions(start)}
              />
              <SelectField
                label={t('meetings.form.end')}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                options={timeOptions(end)}
              />
            </div>
            <RecipientPicker
              label={oneOnOne ? t('meetings.form.onePerson') : t('meetings.form.people')}
              value={people}
              onChange={(next) => setPeople(oneOnOne ? next.slice(-1) : next)}
              exclude={memberId ? [memberId] : []}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('meetings.form.location')}
                placeholder={t('meetings.form.locationPlaceholder')}
                value={location}
                maxLength={200}
                onChange={(e) => setLocation(e.target.value)}
              />
              <TextField
                label={t('meetings.form.link')}
                placeholder={t('meetings.form.linkPlaceholder')}
                type="url"
                dir="ltr"
                value={link}
                maxLength={500}
                onChange={(e) => setLink(e.target.value)}
              />
            </div>
            <LiteField
              label={t('meetings.form.agenda')}
              placeholder={t('meetings.form.agendaPlaceholder')}
              value={agenda}
              onChange={setAgenda}
              maxLength={MEETING_AGENDA_MAX}
            />
            {problem && (
              <p role="alert" className="text-sm font-semibold text-danger-ink">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button type="submit" loading={save.isPending}>
                {meeting ? t('meetings.form.save') : t('meetings.form.create')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                {t('meetings.form.cancel')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
