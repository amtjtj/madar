'use client';

import { CircleCheck, CircleOff, Sparkles } from 'lucide-react';

import { t } from '@madar/i18n';
import { Card, CardContent, CheckboxField, EmptyState, Skeleton, useToast } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useAiStatus, useSaveAiSettings } from '@/hooks/ai';
import { useCan } from '@/hooks/queries';
import { errorMessage } from '@/lib/errors';

/** «دستیار مدار» (ADR 0025): the company switch, off by default; only the owner turns it on. */
export default function AssistantSettingsPage() {
  const can = useCan();
  const { data: status } = useAiStatus();
  const save = useSaveAiSettings();
  const { toast } = useToast();
  return (
    <>
      <PageHeader title={t('assistant.settingsTitle')} subtitle={t('assistant.settingsSubtitle')} />
      {!can('tenant.manage') ? (
        <Card>
          <EmptyState title={t('errors.forbidden')} />
        </Card>
      ) : !status ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="flex items-start gap-3 rounded-xl bg-sunken p-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0">
              {status.available ? (
                <CircleCheck aria-hidden className="text-success-ink" />
              ) : (
                <CircleOff aria-hidden className="text-ink-subtle" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink">{t('assistant.status')}</span>
                <span className="text-ink-muted">
                  {status.available ? t('assistant.installed') : t('assistant.notInstalled')}
                </span>
              </div>
            </div>
            <CheckboxField
              label={t('assistant.toggle')}
              checked={status.enabled}
              disabled={!status.available}
              onChange={(e) =>
                save.mutate(
                  { enabled: e.target.checked },
                  {
                    onSuccess: (next) =>
                      toast({
                        tone: 'success',
                        title: next.enabled ? t('assistant.toggledOn') : t('assistant.toggledOff'),
                      }),
                    onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
                  },
                )
              }
            />
            <p className="flex items-start gap-2 text-sm text-ink-muted [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
              <Sparkles aria-hidden className="text-accent-ink" />
              {t('assistant.whatItSees')} {t('assistant.privacy')}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
