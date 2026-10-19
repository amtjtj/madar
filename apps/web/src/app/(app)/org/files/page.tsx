'use client';

import { useState } from 'react';

import { t } from '@madar/i18n';
import { DEFAULT_MAX_FILE_MB, toLatinDigits, toPersianDigits } from '@madar/shared';
import { Button, Card, CardContent, EmptyState, Skeleton, TextField, useToast } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useCan } from '@/hooks/queries';
import { useFileSettings, useSaveFileSettings } from '@/hooks/files';
import { errorMessage } from '@/lib/errors';

/** The company's file settings (ADR 0019); only the owner changes them. */
export default function FileSettingsPage() {
  const can = useCan();
  const { data } = useFileSettings();
  return (
    <>
      <PageHeader title={t('fileSettings.title')} subtitle={t('fileSettings.subtitle')} />
      {!can('tenant.manage') ? (
        <Card>
          <EmptyState title={t('errors.forbidden')} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <SettingsForm key={data.maxSizeMb} initial={data.maxSizeMb} />
      )}
    </>
  );
}

function SettingsForm({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const save = useSaveFileSettings();
  const { toast } = useToast();
  const number = Number.parseInt(toLatinDigits(value), 10);
  const valid = Number.isInteger(number) && number >= 1 && number <= 100;
  return (
    <Card className="max-w-lg">
      <CardContent className="flex flex-col gap-4">
        <TextField
          label={t('fileSettings.maxSize')}
          hint={t('fileSettings.maxSizeHint', {
            size: toPersianDigits(String(DEFAULT_MAX_FILE_MB)),
          })}
          error={value && !valid ? t('fileSettings.invalid') : undefined}
          inputMode="numeric"
          value={toPersianDigits(value)}
          onChange={(e) => setValue(toLatinDigits(e.target.value))}
        />
        <Button
          className="self-start"
          disabled={!valid}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { maxSizeMb: number },
              {
                onSuccess: () => toast({ tone: 'success', title: t('fileSettings.saved') }),
                onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
              },
            )
          }
        >
          {t('fileSettings.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
