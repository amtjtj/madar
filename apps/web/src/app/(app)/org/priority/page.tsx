'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import {
  DEFAULT_PRIORITY_WEIGHTS,
  formatNumber,
  priorityScore,
  toLatinDigits,
  toPersianDigits,
  type PriorityWeights,
  type RankInput,
} from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  TextField,
  rankText,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useCan } from '@/hooks/queries';
import { usePriorityWeights, useSavePriorityWeights } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

const FIELDS = ['due', 'priority', 'source', 'keyResult', 'weight'] as const;

/** A few typical tasks, ordered with the weights being edited (preview before saving). */
const SAMPLES: Array<
  { key: 'ceoTomorrow' | 'overdueMine' | 'urgentRequest' | 'goalWeek' } & RankInput
> = [
  {
    key: 'ceoTomorrow',
    due: 'tomorrow',
    priority: 'normal',
    source: 'assigned',
    ceo: true,
    keyResult: false,
    weight: 3,
  },
  {
    key: 'overdueMine',
    due: 'overdue',
    priority: 'normal',
    source: 'personal',
    ceo: false,
    keyResult: false,
    weight: 1,
  },
  {
    key: 'urgentRequest',
    due: 'later',
    priority: 'urgent',
    source: 'request',
    ceo: false,
    keyResult: false,
    weight: 2,
  },
  {
    key: 'goalWeek',
    due: 'week',
    priority: 'high',
    source: 'personal',
    ceo: false,
    keyResult: true,
    weight: 4,
  },
];

/** The company's priority weights (ADR 0017); only the owner changes them. */
export default function PriorityWeightsPage() {
  const can = useCan();
  const { data } = usePriorityWeights();
  return (
    <>
      <PageHeader title={t('priorityWeights.title')} subtitle={t('priorityWeights.subtitle')} />
      {!can('tenant.manage') ? (
        <Card>
          <EmptyState title={t('errors.forbidden')} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <WeightsForm key={JSON.stringify(data)} initial={data} />
      )}
    </>
  );
}

function WeightsForm({ initial }: { initial: PriorityWeights }) {
  const [weights, setWeights] = useState(initial);
  const save = useSavePriorityWeights();
  const { toast } = useToast();
  const total = FIELDS.reduce((sum, f) => sum + weights[f], 0);
  const preview = SAMPLES.map((sample) => ({ ...sample, ...priorityScore(sample, weights) })).sort(
    (a, b) => b.score - a.score,
  );

  const change = (field: (typeof FIELDS)[number], raw: string) => {
    const value = Number.parseInt(toLatinDigits(raw), 10);
    setWeights((w) => ({
      ...w,
      [field]: Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, value)),
    }));
  };

  return (
    <div className="grid gap-6 pb-20 md:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card>
        <CardContent className="flex flex-col gap-4">
          {FIELDS.map((field) => (
            <TextField
              key={field}
              label={t(`priorityWeights.fields.${field}`)}
              hint={t(`priorityWeights.hints.${field}`)}
              inputMode="numeric"
              value={toPersianDigits(String(weights[field]))}
              onChange={(e) => change(field, e.target.value)}
            />
          ))}
          <p className="text-sm text-ink-muted">
            {t('priorityWeights.total', { total: formatNumber(total) })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              loading={save.isPending}
              onClick={() =>
                save.mutate(weights, {
                  onSuccess: () => toast({ tone: 'success', title: t('priorityWeights.saved') }),
                  onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
                })
              }
            >
              {t('priorityWeights.save')}
            </Button>
            <Button
              variant="ghost"
              icon={<RotateCcw aria-hidden />}
              onClick={() => setWeights(DEFAULT_PRIORITY_WEIGHTS)}
            >
              {t('priorityWeights.reset')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-ink">{t('priorityWeights.preview')}</h2>
          <ol className="flex flex-col gap-2">
            {preview.map((item, index) => (
              <li key={item.key} className="flex gap-3 rounded-lg bg-sunken p-3">
                <span className="font-bold text-ink-subtle">{formatNumber(index + 1)}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-ink">
                    {t(`priorityWeights.sample.${item.key}`)}
                  </span>
                  <span className="text-xs text-ink-muted">{rankText(item.reasons)}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
