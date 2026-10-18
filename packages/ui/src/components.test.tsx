import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInitials } from './lib/initials.js';
import { Button } from './components/button.js';
import { CompleteCheck } from './components/complete-check.js';
import { DatePicker } from './components/date-picker.js';
import { TaskCard } from './components/task-card.js';
import { TextField } from './components/input.js';
import { ProgressBar } from './components/progress.js';
import { ThemeToggle } from './components/theme.js';

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
