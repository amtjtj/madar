'use client';

import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, toLatinDigits } from '@madar/shared';
import { Button, Card, CardContent, EmptyState, Skeleton, TextField, useToast } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useApprovalSettings, useSaveApprovalSettings } from '@/hooks/requests';
import { useCan } from '@/hooks/queries';
import { errorMessage } from '@/lib/errors';

/** «گردش تایید» (ADR 0028): the expense amount above which the leadership approves too. */
export default function ApprovalSettingsPage() {
  const can = useCan();
  const { data, isPending } = useApprovalSettings();
  if (!can('tenant.manage')) {
    return <EmptyState title={t('errors.forbidden')} />;
  }
  return (
    <>
      <PageHeader title={t('requests.settings.title')} />
      {isPending || !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <ThresholdForm initial={data.expenseThresholdToman} />
      )}
    </>
  );
}

function ThresholdForm({ initial }: { initial: number }) {
  const save = useSaveApprovalSettings();
  const { toast } = useToast();
  const [value, setValue] = useState(formatNumber(initial));
  const amount = Number(toLatinDigits(value).replace(/[^\d]/g, ''));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      { expenseThresholdToman: amount },
      {
        onSuccess: () => toast({ tone: 'success', title: t('requests.settings.saved') }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
          <TextField
            label={t('requests.settings.threshold')}
            hint={t('requests.settings.thresholdHint')}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setValue(formatNumber(amount))}
          />
          <Button type="submit" className="self-start" loading={save.isPending}>
            {t('requests.settings.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
