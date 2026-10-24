import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  toPersianDigits,
  type ExpenseData,
  type GeneralData,
  type LeaveData,
  type RequestSummary,
} from '@madar/shared';

/** The words for a request row or page title (plan phase-3-step-17b): all text from i18n. */
export function requestTitle(request: Pick<RequestSummary, 'kind' | 'title' | 'data'>): string {
  if (request.kind === 'general') return request.title || (request.data as GeneralData).body;
  if (request.kind === 'expense') {
    const data = request.data as ExpenseData;
    return t('requests.titles.expense', { category: t(`requests.categories.${data.category}`) });
  }
  const data = request.data as LeaveData;
  if (data.kind === 'hourly') {
    return t('requests.titles.leaveHours', { date: formatCalendarDate(data.on) });
  }
  return data.startsOn === data.endsOn
    ? t('requests.titles.leaveDay', { date: formatCalendarDate(data.startsOn) })
    : t('requests.titles.leaveDays', {
        from: formatCalendarDate(data.startsOn),
        to: formatCalendarDate(data.endsOn),
      });
}

/** Every quarter hour from 06:00 to 22:00, in Persian digits (an hourly leave's times). */
export function quarterTimeOptions(): Array<{ value: string; label: string }> {
  return Array.from({ length: 65 }, (_, i) => {
    const minutes = 6 * 60 + i * 15;
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return { value, label: toPersianDigits(value) };
  });
}
