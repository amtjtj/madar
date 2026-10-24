'use client';

import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  formatNumber,
  formatPercent,
  toLatinDigits,
  type GamificationSettings,
} from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  CheckboxField,
  EmptyState,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useGamificationSettings, useSaveGamificationSettings } from '@/hooks/progress';
import { useCan } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';

const PERCENTS = [50, 60, 70, 80, 100];

/** «گیمیفیکیشن» (ADR 0029): on or off, what a complete day takes and the daily XP cap. */
export default function GamificationSettingsPage() {
  const can = useCan();
  const { data: me } = useMe();
  const { data, isPending } = useGamificationSettings();
  if (me && !can('tenant.manage')) {
    return <EmptyState title={t('errors.forbidden')} />;
  }
  return (
    <>
      <PageHeader
        title={t('progress.settings.title')}
        subtitle={t('progress.settings.description')}
      />
      {!me || isPending || !data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <SettingsForm initial={data} />
      )}
    </>
  );
}

function SettingsForm({ initial }: { initial: GamificationSettings }) {
  const save = useSaveGamificationSettings();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [percent, setPercent] = useState(initial.completeDayPercent);
  const [cap, setCap] = useState(formatNumber(initial.dailyXpCap));
  const capValue = Number(toLatinDigits(cap).replace(/[^\d]/g, ''));
  const capInvalid = capValue < 20 || capValue > 1000;
  const [kudos, setKudos] = useState(formatNumber(initial.kudosPerWeek));
  const kudosValue = Number(toLatinDigits(kudos).replace(/[^\d]/g, ''));
  const kudosInvalid = kudosValue < 1 || kudosValue > 20;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (capInvalid || kudosInvalid) return;
    save.mutate(
      { enabled, completeDayPercent: percent, dailyXpCap: capValue, kudosPerWeek: kudosValue },
      {
        onSuccess: () => toast({ tone: 'success', title: t('progress.settings.saved') }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
          <CheckboxField
            label={t('progress.settings.enabled')}
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <SelectField
            label={t('progress.settings.percent')}
            value={String(percent)}
            onChange={(e) => setPercent(Number(e.target.value))}
            options={(PERCENTS.includes(percent)
              ? PERCENTS
              : [...PERCENTS, percent].sort((a, b) => a - b)
            ).map((p) => ({ value: String(p), label: formatPercent(p / 100) }))}
            disabled={!enabled}
          />
          <TextField
            label={t('progress.settings.cap')}
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => capValue && setCap(formatNumber(capValue))}
            error={capInvalid ? t('progress.settings.capRange') : undefined}
            disabled={!enabled}
          />
          <TextField
            label={t('progress.settings.kudos')}
            inputMode="numeric"
            value={kudos}
            onChange={(e) => setKudos(e.target.value)}
            onBlur={() => kudosValue && setKudos(formatNumber(kudosValue))}
            error={kudosInvalid ? t('progress.settings.kudosRange') : undefined}
            disabled={!enabled}
          />
          <Button type="submit" className="self-start" loading={save.isPending}>
            {t('progress.settings.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
