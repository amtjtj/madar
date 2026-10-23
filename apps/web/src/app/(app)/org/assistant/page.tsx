'use client';

import { CircleAlert, CircleCheck, CircleOff, Database, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { Card, CardContent, CheckboxField, EmptyState, Skeleton, useToast } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useAiHealth, useAiStatus, useKnowledgeIndex, useSaveAiSettings } from '@/hooks/ai';
import { useCan } from '@/hooks/queries';
import { errorMessage } from '@/lib/errors';

/** «دستیار مدار» (ADR 0025): the company switch, off by default; only the owner turns it on. */
export default function AssistantSettingsPage() {
  const can = useCan();
  const { data: status } = useAiStatus();
  const { data: health, isPending: checking } = useAiHealth(
    Boolean(status?.available) && can('tenant.manage'),
  );
  // Three states: not installed, installed and answering, installed but not answering.
  const working = Boolean(health?.reachable && health.modelReachable);
  const save = useSaveAiSettings();
  const { data: index } = useKnowledgeIndex(Boolean(status?.enabled) && can('tenant.manage'));
  const { toast } = useToast();
  // Set in the click itself so the switch never flickers back while the request is in flight.
  const [pending, setPending] = useState<boolean | null>(null);
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
              {status.available && working ? (
                <CircleCheck aria-hidden className="text-success-ink" />
              ) : status.available && !checking ? (
                <CircleAlert aria-hidden className="text-warning-ink" />
              ) : (
                <CircleOff aria-hidden className="text-ink-subtle" />
              )}
              <div className="flex flex-col gap-0.5" role="status">
                <span className="font-semibold text-ink">{t('assistant.status')}</span>
                <span className="text-ink-muted">
                  {!status.available
                    ? t('assistant.notInstalled')
                    : checking
                      ? t('assistant.checking')
                      : working
                        ? t('assistant.installed')
                        : t('assistant.unreachable')}
                </span>
              </div>
            </div>
            <CheckboxField
              label={t('assistant.toggle')}
              checked={pending ?? status.enabled}
              disabled={!status.available}
              onChange={(e) => {
                const enabled = e.target.checked;
                setPending(enabled);
                save.mutate(
                  { enabled },
                  {
                    onSuccess: (next) =>
                      toast({
                        tone: 'success',
                        title: next.enabled ? t('assistant.toggledOn') : t('assistant.toggledOff'),
                      }),
                    onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
                    onSettled: () => setPending(null),
                  },
                );
              }}
            />
            <p className="flex items-start gap-2 text-sm text-ink-muted [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
              <Sparkles aria-hidden className="text-accent-ink" />
              {t('assistant.whatItSees')} {t('assistant.privacy')}
            </p>
            <section
              aria-labelledby="knowledge-index"
              className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm"
            >
              <h2
                id="knowledge-index"
                className="flex items-center gap-2 font-semibold text-ink [&_svg]:size-4 [&_svg]:text-ink-muted"
              >
                <Database aria-hidden />
                {t('assistant.index.title')}
              </h2>
              {!status.enabled ? (
                <p className="text-ink-muted">{t('assistant.index.off')}</p>
              ) : !index ? (
                <Skeleton className="h-5 w-2/3" />
              ) : (
                <p className="text-ink-muted" role="status">
                  {index.pending > 0
                    ? t('assistant.index.preparing', { count: formatNumber(index.pending) })
                    : t('assistant.index.ready')}{' '}
                  {t('assistant.index.counts', {
                    tasks: formatNumber(index.sources.task),
                    letters: formatNumber(index.sources.letter),
                    meetings: formatNumber(index.sources.meeting),
                    channels: formatNumber(index.sources.channel),
                  })}
                </p>
              )}
              <p className="text-ink-subtle">{t('assistant.index.never')}</p>
            </section>
          </CardContent>
        </Card>
      )}
    </>
  );
}
