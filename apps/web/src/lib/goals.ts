import { t } from '@madar/i18n';
import {
  formatNumber,
  formatPercent,
  type CheckinStatus,
  type GoalPeriod,
  type KeyResult,
} from '@madar/shared';

/** «پاییز ۱۴۰۵» */
export function periodName(period: Pick<GoalPeriod, 'year' | 'quarter'>): string {
  return t(`goals.seasons.${period.quarter as 1 | 2 | 3 | 4}`, {
    year: formatNumber(period.year, { useGrouping: false }),
  });
}

/** Badge tone for a check-in status (null: not checked in yet). */
export function statusTone(
  status: CheckinStatus | null,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'on_track') return 'success';
  if (status === 'at_risk') return 'warning';
  if (status === 'off_track') return 'danger';
  return 'neutral';
}

/** A key result value with its unit: «۱۴ ساعت», «۴۰٪», «انجام شد». */
export function formatKrValue(kr: Pick<KeyResult, 'kind' | 'unit'>, value: number): string {
  if (kr.kind === 'boolean') return value >= 1 ? t('goals.value.done') : t('goals.value.notDone');
  if (kr.kind === 'percent') return formatPercent(value / 100);
  return kr.unit ? `${formatNumber(value)} ${kr.unit}` : formatNumber(value);
}

/** «۱۴ از ۴ ساعت» */
export function formatKrProgress(kr: KeyResult): string {
  if (kr.kind === 'boolean') return formatKrValue(kr, kr.currentValue);
  return t('goals.value.ofTarget', {
    current:
      kr.kind === 'percent' ? formatPercent(kr.currentValue / 100) : formatNumber(kr.currentValue),
    target: formatKrValue(kr, kr.targetValue),
  });
}
