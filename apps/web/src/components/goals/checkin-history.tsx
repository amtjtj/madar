'use client';

import { t } from '@madar/i18n';
import { formatJalaliDate, type Checkin, type KeyResult } from '@madar/shared';
import { Badge, Skeleton } from '@madar/ui';

import { useCheckins } from '@/hooks/goals';
import { formatKrValue, statusTone } from '@/lib/goals';

const W = 320;
const H = 96;
const PAD = 10;

/**
 * Value over time (one series, one axis) with the target as a dashed line. Time runs left to
 * right like any chart readers know; each point has a native tooltip, and the list below is
 * the table view of the same data.
 */
function HistoryChart({ kr, checkins }: { kr: KeyResult; checkins: Checkin[] }) {
  const points = [...checkins].reverse();
  const values = [kr.startValue, kr.targetValue, ...points.map((c) => c.value)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) =>
    max === min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);
  const x = (i: number) =>
    points.length <= 1 ? W / 2 : PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const path = points
    .map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.value).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t('goals.detail.history')}
      className="h-24 w-full overflow-visible"
    >
      <line
        x1={0}
        x2={W}
        y1={y(kr.targetValue)}
        y2={y(kr.targetValue)}
        className="stroke-line-strong"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {points.length > 1 && (
        <path
          d={path}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {points.map((c, i) => (
        <g key={c.id}>
          {/* Larger invisible hit target for the tooltip. */}
          <circle cx={x(i)} cy={y(c.value)} r={12} className="fill-transparent">
            <title>{`${formatKrValue(kr, c.value)}، ${formatJalaliDate(new Date(c.createdAt), 'medium')}`}</title>
          </circle>
          <circle
            cx={x(i)}
            cy={y(c.value)}
            r={4}
            className="pointer-events-none fill-primary stroke-surface"
            strokeWidth={2}
          />
        </g>
      ))}
    </svg>
  );
}

export function CheckinHistory({ kr }: { kr: KeyResult }) {
  const { data: checkins, isPending } = useCheckins(kr.id, true);
  if (isPending || !checkins) return <Skeleton className="h-24 rounded-lg" />;
  if (checkins.length === 0) {
    return <p className="text-sm text-ink-muted">{t('goals.detail.noHistory')}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {kr.kind !== 'boolean' && <HistoryChart kr={kr} checkins={checkins} />}
      <ol className="flex flex-col divide-y divide-line">
        {checkins.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink tabular-nums">
                {formatKrValue(kr, c.value)}
              </span>
              <Badge tone={statusTone(c.status)} dot>
                {t(`goals.statuses.${c.status}`)}
              </Badge>
              <span className="text-xs text-ink-subtle">
                {t('goals.checkin.by', {
                  name: c.author.displayName,
                  time: formatJalaliDate(new Date(c.createdAt), 'medium'),
                })}
              </span>
            </div>
            {c.note && <p className="text-sm text-ink-muted">{c.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
