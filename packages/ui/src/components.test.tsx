import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInitials } from './lib/initials.js';
import { Button } from './components/button.js';
import { CompleteCheck } from './components/complete-check.js';
import { DatePicker } from './components/date-picker.js';
import { TaskCard } from './components/task-card.js';
import { TextField } from './components/input.js';
import { ProgressBar } from './components/progress.js';
import { Slider } from './components/slider.js';
import { ThemeToggle } from './components/theme.js';
import { LetterRow, LiteText, RecipientChip, UrgencyBadge } from './components/letter.js';
import { AudienceNote, EvidenceCard, MinutesEvidenceCard } from './components/evidence.js';
import { CalendarItemRow, CalendarMonth, LayerToggle } from './components/calendar.js';
import {
  CalendarDnd,
  DayStrip,
  DragItem,
  TimedEvent,
  WeekGrid,
} from './components/calendar-week.js';
import {
  DecisionItem,
  MeetingRow,
  MeetingTypeBadge,
  ResponseBadge,
  RsvpButtons,
} from './components/meeting.js';
import {
  ConversationRow,
  MentionSuggestions,
  MessageBubble,
  MessageText,
  ReactionBar,
  ReactionPicker,
} from './components/chat.js';

afterEach(cleanup);

describe('getInitials', () => {
  it('takes the first letters of the first and last name', () => {
    expect(getInitials('مریم احمدی')).toBe('م‌ا');
    expect(getInitials('Sara Mohammadi')).toBe('S‌M');
  });

  it('treats ZWNJ as a word break and handles single names', () => {
    expect(getInitials('علی')).toBe('ع');
    expect(getInitials('  ')).toBe('');
    expect(getInitials('مریم احمدی', 1)).toBe('م');
  });
});

describe('Button', () => {
  it('defaults to type="button" and marks loading as busy', () => {
    render(<Button loading>ثبت</Button>);
    const button = screen.getByRole('button', { name: 'ثبت' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});

describe('TextField', () => {
  it('links label, input and error message', () => {
    render(<TextField label="نام کاربری" error="تکراری است" />);
    const input = screen.getByLabelText('نام کاربری');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('تکراری است');
  });
});

describe('ProgressBar', () => {
  it('exposes clamped progress to assistive tech with Persian text', () => {
    render(<ProgressBar value={1.4} label="برنامه امروز" />);
    const bar = screen.getByRole('progressbar', { name: 'برنامه امروز' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toContain('۱۰۰٪');
  });
});

describe('CompleteCheck', () => {
  it('toggles through onCheckedChange', () => {
    const onChange = vi.fn();
    render(<CompleteCheck checked={false} onCheckedChange={onChange} label="گزارش" xp={20} />);
    const box = screen.getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('ThemeToggle', () => {
  it('applies and persists the chosen theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('radio', { name: /تیره/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('madar-theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: /تیره/ }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: /سیستم/ }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('madar-theme')).toBeNull();
  });
});

describe('DatePicker', () => {
  it('shows the Jalali month and picks a day', () => {
    const onChange = vi.fn();
    render(<DatePicker value={null} onChange={onChange} today="2026-10-17" label="سررسید" />);
    fireEvent.click(screen.getByRole('button', { name: 'سررسید' }));
    expect(screen.getByText('مهر ۱۴۰۵')).toBeTruthy();
    // Today is marked; Friday is labelled as a holiday.
    expect(
      screen.getByRole('button', { name: 'شنبه ۲۵ مهر ۱۴۰۵' }).getAttribute('aria-current'),
    ).toBe('date');
    expect(screen.getByRole('button', { name: 'جمعه ۲۴ مهر ۱۴۰۵ (تعطیل)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'دوشنبه ۲۷ مهر ۱۴۰۵' }));
    expect(onChange).toHaveBeenCalledWith('2026-10-19');
  });

  it('offers quick picks and moves between months', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-10-18" onChange={onChange} today="2026-10-17" label="سررسید" />);
    fireEvent.click(screen.getByRole('button', { name: 'سررسید' }));
    fireEvent.click(screen.getByRole('button', { name: 'ماه بعد' }));
    expect(screen.getByText('آبان ۱۴۰۵')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'شنبه بعد' }));
    expect(onChange).toHaveBeenCalledWith('2026-10-24');
  });
});

describe('TaskCard', () => {
  it('shows due status, priority and counts, and toggles completion', () => {
    const onDoneChange = vi.fn();
    render(
      <TaskCard
        title="ارسال گزارش"
        done={false}
        onDoneChange={onDoneChange}
        today="2026-10-17"
        dueOn="2026-10-15"
        priority="urgent"
        subtasks={{ done: 1, total: 3 }}
        commentCount={2}
      />,
    );
    expect(screen.getByText('عقب‌افتاده، ۲۳ مهر')).toBeTruthy();
    expect(screen.getByText('فوری')).toBeTruthy();
    expect(screen.getByText('۱ از ۳ زیرکار')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDoneChange).toHaveBeenCalledWith(true);
  });
});

describe('charts', () => {
  it('shows Persian digits and keeps a table for screen readers', async () => {
    const { BarList } = await import('./components/charts.js');
    render(
      <BarList
        title="کارهای گذشته از سررسید"
        items={[
          { key: 'a', label: 'پشتیبانی', value: 7, href: '/tasks?due=overdue' },
          { key: 'b', label: 'فنی', value: 0 },
        ]}
      />,
    );
    // Linked rows carry name and value themselves.
    expect(screen.getByRole('link', { name: 'پشتیبانی: ۷' })).toBeTruthy();
    expect(screen.getAllByText('۷').length).toBeGreaterThan(0);
  });

  it('labels the latest column and shows a tooltip on tap, with a table for screen readers', async () => {
    const { ColumnChart } = await import('./components/charts.js');
    const { container } = render(
      <ColumnChart
        title="انجام‌شده در هفته"
        points={[
          { key: '1', label: 'هفته ۱', value: 3 },
          { key: '2', label: 'هفته ۲', value: 12 },
        ]}
      />,
    );
    expect(screen.getAllByText('۱۲').length).toBeGreaterThan(0);
    expect(container.querySelector('[tabindex]')).toBeNull();
    const first = container.querySelector('[dir="ltr"] > div') as HTMLElement;
    fireEvent.click(first);
    expect(screen.getByText('هفته ۱: ۳')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'انجام‌شده در هفته' })).toBeTruthy();
  });
});

describe('Slider', () => {
  it('is a labelled range in steps, with a Persian value for screen readers', () => {
    const onChange = vi.fn();
    render(<Slider label="درصد پیشرفت" value={50} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'درصد پیشرفت' });
    expect(slider.getAttribute('step')).toBe('5');
    expect(slider.getAttribute('aria-valuetext')).toBe('۵۰٪');
    fireEvent.change(slider, { target: { value: '55' } });
    expect(onChange).toHaveBeenCalledWith(55);
  });
});

describe('TaskCard progress', () => {
  it('shows a thin bar only between 0 and 100', () => {
    const { rerender } = render(
      <TaskCard title="کار" done={false} today="2026-10-19" progress={40} />,
    );
    expect(screen.getByRole('progressbar', { name: 'پیشرفت' }).getAttribute('aria-valuenow')).toBe(
      '40',
    );
    rerender(<TaskCard title="کار" done={false} today="2026-10-19" progress={0} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('LiteText', () => {
  it('renders lists, bold and paragraphs as elements, never as HTML', () => {
    const { container } = render(
      <LiteText text={'سلام **مهم**\nخط دوم\n\n- بند اول\n- <script>alert(1)</script>'} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('مهم');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeDefined();
  });
});

describe('Letter parts', () => {
  it('shows urgency only when the letter is not normal', () => {
    const { container } = render(<UrgencyBadge urgency="normal" />);
    expect(container.textContent).toBe('');
    render(<UrgencyBadge urgency="immediate" />);
    expect(screen.getByText('آنی')).toBeDefined();
  });

  it('a row links to the letter with its number in Persian digits', () => {
    render(
      <LetterRow
        href="/letters/1"
        person="علی رضایی"
        subject="پیگیری قرارداد"
        number="1405/00042"
        date="۲۸ مهر"
        urgency="urgent"
        confidential
        attachmentCount={2}
        unread
      />,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('/letters/1');
    expect(screen.getByText('۱۴۰۵/۰۰۰۴۲')).toBeDefined();
    expect(screen.getByText('خوانده‌نشده')).toBeDefined();
    expect(screen.getByText('محرمانه')).toBeDefined();
  });

  it('a recipient chip can be removed', () => {
    const onRemove = vi.fn();
    render(<RecipientChip name="مریم احمدی" onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'برداشتن مریم احمدی' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('Evidence', () => {
  const summary = {
    subject: 'پیگیری قرارداد',
    number: '1405/00042',
    sender: { id: 'a', displayName: 'علی رضایی' },
    to: [{ id: 'b', displayName: 'مدیر حقوقی' }],
    date: '2026-10-19T08:00:00.000Z',
    urgency: 'normal' as const,
    read: true,
    attachmentCount: 1,
  };

  it('shows one read flag and opens the letter', () => {
    const onOpen = vi.fn();
    render(<EvidenceCard summary={summary} onOpen={onOpen} onUnpin={() => {}} />);
    expect(screen.getByText('خوانده شد')).toBeDefined();
    expect(screen.getByText('۱۴۰۵/۰۰۰۴۲')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'دیدن نامه پیگیری قرارداد' }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'برداشتن شاهد پیگیری قرارداد' })).toBeDefined();
  });

  it('says when the item is no longer available', () => {
    render(<EvidenceCard summary={null} />);
    expect(screen.getByText('این مورد دیگر در دسترس نیست.')).toBeDefined();
  });

  it('names people and groups who will see it', () => {
    render(
      <AudienceNote
        audience={{
          people: [{ id: 'a', displayName: 'مریم احمدی', role: 'reporter' }],
          groups: [{ kind: 'department', name: 'پشتیبانی' }],
        }}
      />,
    );
    expect(screen.getByText('مریم احمدی (ثبت‌کننده)')).toBeDefined();
    expect(screen.getByText('اعضای دپارتمان «پشتیبانی»')).toBeDefined();
  });
});

describe('Chat', () => {
  it('links only http(s) and never renders HTML', () => {
    const { container } = render(
      <MessageText body={'ببین https://example.ir و <b>x</b> javascript:alert(1)'} />,
    );
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://example.ir');
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows a deleted message without its text, and a reply quote', () => {
    render(
      <MessageBubble
        mine={false}
        author="مریم احمدی"
        body="متن"
        time="۱۰:۳۰"
        deleted
        replyTo={{ author: 'علی رضایی', body: 'گزارش', deleted: false }}
      />,
    );
    expect(screen.getByText('این پیام حذف شد')).toBeDefined();
    expect(screen.queryByText('متن')).toBeNull();
    expect(screen.getByText('گزارش')).toBeDefined();
  });

  it('shows mentions with current names as elements, and an unknown one as «@کسی»', () => {
    const id = '0190a1b2-0000-7000-8000-000000000001';
    const other = '0190a1b2-0000-7000-8000-000000000009';
    const { container } = render(
      <MessageText
        body={`<@${id}> ببین و <@${other}>`}
        mentions={[{ id, displayName: 'مریم احمدی' }]}
        meId={id}
      />,
    );
    expect(screen.getByText('@مریم احمدی').className).toContain('bg-primary-soft');
    expect(screen.getByText('@کسی')).toBeDefined();
    expect(container.textContent).not.toContain(id);
  });

  it('reaction chips toggle the person’s own reaction; readers get no buttons', () => {
    const onToggle = vi.fn();
    const reactions = [
      { emoji: '👍' as const, names: ['مریم احمدی', 'علی رضایی'], mine: true },
      { emoji: '🎉' as const, names: ['علی رضایی'], mine: false },
    ];
    render(<ReactionBar reactions={reactions} onToggle={onToggle} />);
    const like = screen.getByRole('button', { name: '👍 ۲: مریم احمدی، علی رضایی' });
    expect(like.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(like);
    expect(onToggle).toHaveBeenCalledWith('👍', false);
    fireEvent.click(screen.getByRole('button', { name: '🎉 ۱: علی رضایی' }));
    expect(onToggle).toHaveBeenLastCalledWith('🎉', true);
    cleanup();
    render(<ReactionBar reactions={reactions} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('img', { name: '🎉 ۱: علی رضایی' })).toBeDefined();
    // A tap shows the names to people who only read (no hover on phones).
    fireEvent.click(screen.getByRole('img', { name: '👍 ۲: مریم احمدی، علی رضایی' }));
    expect(screen.getByText('👍 مریم احمدی، علی رضایی')).toBeDefined();
  });

  it('the reaction picker offers the six reactions', () => {
    const onPick = vi.fn();
    render(<ReactionPicker mine={['❤️']} onPick={onPick} />);
    expect(screen.getAllByRole('button')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'واکنش ❤️' }));
    expect(onPick).toHaveBeenCalledWith('❤️', false);
  });

  it('mention suggestions mark the active person and pick on press', () => {
    const onPick = vi.fn();
    const people = [
      { id: 'a', displayName: 'مریم احمدی' },
      { id: 'b', displayName: 'علی رضایی' },
    ];
    render(<MentionSuggestions id="m" people={people} activeIndex={1} onPick={onPick} />);
    const options = screen.getAllByRole('option');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseDown(options[0] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(people[0]);
    cleanup();
    render(<MentionSuggestions id="m" people={[]} activeIndex={0} onPick={onPick} />);
    expect(screen.getByText('کسی پیدا نشد')).toBeDefined();
  });

  it('a conversation row shows the unread count', () => {
    render(<ConversationRow href="/chat/1" kind="group" title="شیفت صبح" unread={3} />);
    expect(screen.getByText('۳ پیام خوانده‌نشده')).toBeDefined();
  });
});

describe('meetings', () => {
  it('shows a canceled meeting struck through with its badges', () => {
    render(
      <MeetingRow
        href="/meetings/1"
        title="بررسی صف برداشت"
        type="okr_review"
        time="ساعت ۱۰:۰۰ تا ۱۱:۰۰"
        participantCount={3}
        hasMinutes
        canceled
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/meetings/1');
    expect(screen.getByText('بررسی صف برداشت').className).toContain('line-through');
    expect(screen.getByText('لغو شد')).toBeTruthy();
    expect(screen.getByText('صورت‌جلسه دارد')).toBeTruthy();
    expect(screen.getByText('بررسی OKR')).toBeTruthy();
    expect(screen.getByText('۳ نفر')).toBeTruthy();
  });

  it('names the meeting type', () => {
    render(<MeetingTypeBadge type="one_on_one" />);
    expect(screen.getByText('یک‌به‌یک')).toBeTruthy();
  });

  it('links a decision to its task only when the viewer may open it', () => {
    const { rerender } = render(
      <DecisionItem
        text="بررسی روزانه"
        keyResult="زمان پاسخ"
        task={{ title: 'بررسی روزانه صف', assignee: 'علی', href: '/tasks/1' }}
      />,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('/tasks/1');
    expect(screen.getByText('نتیجه کلیدی: زمان پاسخ')).toBeTruthy();
    rerender(<DecisionItem text="بررسی روزانه" task={{ title: null }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('از این مصوبه کار ساخته شده است')).toBeTruthy();
  });
});

describe('meeting replies and minutes evidence', () => {
  it('presses the current reply and reports a change only', () => {
    const onChange = vi.fn();
    render(<RsvpButtons value="accepted" onChange={onChange} />);
    const yes = screen.getByRole('button', { name: 'می‌آیم' });
    const no = screen.getByRole('button', { name: 'نمی‌آیم' });
    expect(yes.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(yes);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(no);
    expect(onChange).toHaveBeenCalledWith('declined');
  });

  it('names a reply', () => {
    render(<ResponseBadge response="pending" />);
    expect(screen.getByText('بی‌پاسخ')).toBeTruthy();
  });

  it('shows the meeting title and excerpt, never people', () => {
    render(
      <MinutesEvidenceCard
        minutes={{
          meeting: { title: 'بررسی هفتگی', type: 'regular' },
          date: '2026-10-24T05:30:00.000Z',
          excerpt: 'صف بررسی شد',
          attachmentCount: 1,
        }}
        date="۲ آبان"
      />,
    );
    expect(screen.getByText('صورت‌جلسه «بررسی هفتگی»، ۲ آبان')).toBeTruthy();
    expect(screen.getByText('صف بررسی شد')).toBeTruthy();
  });

  it('marks a weekly meeting and one I declined', () => {
    render(
      <MeetingRow
        href="#"
        title="هماهنگی"
        type="regular"
        time="ساعت ۹:۰۰"
        participantCount={3}
        hasMinutes={false}
        canceled={false}
        weekly
        declined
      />,
    );
    expect(screen.getByText('هفتگی')).toBeTruthy();
    expect(screen.getByText('نمی‌آیم')).toBeTruthy();
  });
});

describe('calendar', () => {
  it('links an item and strikes a canceled one', () => {
    render(
      <CalendarItemRow layer="meeting" title="هماهنگی" href="/meetings/1" time="۱۰:۰۰" struck />,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('/meetings/1');
    expect(screen.getByText('هماهنگی').className).toContain('line-through');
  });

  it('opens a day and marks today', () => {
    const onSelect = vi.fn();
    const cells = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-10-${24 + i}`,
      inMonth: true,
      today: i === 0,
      off: i === 6,
      items: i === 1 ? [{ layer: 'task' as const, title: 'گزارش' }] : [],
    }));
    render(<CalendarMonth cells={cells} onSelect={onSelect} dayLabel={(c) => `روز ${c.date}`} />);
    fireEvent.click(screen.getByRole('button', { name: 'روز 2026-10-25' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-25');
    expect(screen.getByText('۲')).toBeTruthy(); // 2026-10-24 is 2 Aban
  });

  it('switches a layer', () => {
    const onChange = vi.fn();
    render(<LayerToggle layer="task" label="سررسید کارها" checked onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'سررسید کارها' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('week calendar', () => {
  const days = ['2026-10-24', '2026-10-25'].map((date, i) => ({
    date,
    today: i === 0,
    off: false,
  }));

  it('places all-day items, timed events and the now line', () => {
    render(
      <WeekGrid
        days={days}
        startHour={9}
        endHour={12}
        allDay={(d) => <span>{`سررسید ${d.date}`}</span>}
        events={[
          {
            id: 'm1',
            date: '2026-10-25',
            start: 600,
            end: 660,
            column: 0,
            columns: 1,
            node: <TimedEvent title="بررسی صف" time="۱۰:۰۰ تا ۱۱:۰۰" href="/meetings/1" />,
          },
        ]}
        nowMinutes={610}
        dayLabel={(d) => `ستون ${d.date}`}
      />,
    );
    expect(screen.getByText('سررسید 2026-10-24')).toBeTruthy();
    expect(screen.getByRole('link', { name: /بررسی صف/ }).getAttribute('href')).toBe('/meetings/1');
    expect(screen.getByText('اکنون')).toBeTruthy();
    expect(screen.getByLabelText('ستون 2026-10-25')).toBeTruthy();
  });

  it('picks a day from the strip', () => {
    const onSelect = vi.fn();
    render(
      <DayStrip
        days={days.map((d) => ({ ...d, busy: true }))}
        selected="2026-10-24"
        onSelect={onSelect}
        dayLabel={(d) => `روز ${d.date}`}
        label="روزهای هفته"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'روز 2026-10-24' }).getAttribute('aria-current'),
    ).toBe('date');
    fireEvent.click(screen.getByRole('button', { name: 'روز 2026-10-25' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-25');
  });

  it('gives a drag handle only inside CalendarDnd', () => {
    const row = (
      <DragItem id="t1" title="گزارش">
        {(handle) => (
          <div>
            {handle}
            <span>گزارش</span>
          </div>
        )}
      </DragItem>
    );
    const { unmount } = render(row);
    expect(screen.queryByRole('button', { name: /جابه‌جا کردن/ })).toBeNull();
    unmount();
    render(
      <CalendarDnd onMove={vi.fn()} itemTitle={() => 'گزارش'} dayLabel={(d) => d}>
        {row}
      </CalendarDnd>,
    );
    expect(screen.getByRole('button', { name: 'جابه‌جا کردن «گزارش» به روز دیگر' })).toBeTruthy();
  });
});
