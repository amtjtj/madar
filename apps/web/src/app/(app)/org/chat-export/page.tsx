'use client';

import { Building2, Download, FolderKanban, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { calendarDateIn, formatNumber } from '@madar/shared';
import { Button, Card, DatePicker, EmptyState, Skeleton, useToast } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useExportChannel, useExportChannels } from '@/hooks/chat';
import { useCan } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { chatExportCsv } from '@/lib/chat';
import { errorMessage } from '@/lib/errors';

/**
 * «خروجی گفت‌وگوها» (plan phase-2-step-15c): project and department channels as CSV, for people
 * with chat.export. Direct and group conversations never appear here; every export is audited.
 */
export default function ChatExportPage() {
  const can = useCan();
  const allowed = can('chat.export');
  const { data: me } = useMe();
  const timeZone = me?.tenant?.timezone;
  const { data: channels, isPending } = useExportChannels(allowed);
  const exportChannel = useExportChannel();
  const { toast } = useToast();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = calendarDateIn(new Date(), timeZone);

  const download = (id: string) => {
    setBusy(id);
    exportChannel.mutate(
      { id, from, to },
      {
        onSuccess: (data) => {
          const blob = new Blob([chatExportCsv(data, timeZone)], {
            type: 'text/csv;charset=utf-8',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = t('chatExport.fileName', { name: data.channel.title });
          // In the page, and the URL kept until the download has started, or the name is lost.
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          toast({ tone: 'success', title: t('chatExport.done', { name: data.channel.title }) });
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
        onSettled: () => setBusy(null),
      },
    );
  };

  return (
    <>
      <PageHeader title={t('chatExport.title')} subtitle={t('chatExport.subtitle')} />
      {!allowed ? (
        <Card>
          <EmptyState title={t('errors.forbidden')} />
        </Card>
      ) : (
        <div className="flex max-w-2xl flex-col gap-4">
          <p
            role="note"
            className="flex items-start gap-2 rounded-xl bg-info-soft p-3 text-sm text-info-ink [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <ShieldCheck aria-hidden />
            {t('chatExport.privacy')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker
              label={t('chatExport.from')}
              value={from}
              onChange={setFrom}
              today={today}
            />
            <DatePicker label={t('chatExport.to')} value={to} onChange={setTo} today={today} />
          </div>
          {isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : !channels?.length ? (
            <Card>
              <EmptyState title={t('chatExport.empty')} description={t('chatExport.emptyHint')} />
            </Card>
          ) : (
            <Card className="p-0">
              <ul className="flex flex-col divide-y divide-line">
                {channels.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink [&_svg]:size-5">
                      {c.kind === 'project' ? (
                        <FolderKanban aria-hidden />
                      ) : (
                        <Building2 aria-hidden />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold text-ink">{c.title}</span>
                      <span className="text-xs text-ink-muted">
                        {t(`chatExport.kinds.${c.kind}`)}
                        {t('ui.listSeparator')}
                        {t('chatExport.messages', { count: formatNumber(c.messageCount) })}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download aria-hidden />}
                      loading={busy === c.id}
                      aria-label={t('chatExport.download', { name: c.title })}
                      onClick={() => download(c.id)}
                    >
                      <span className="hidden sm:inline">{t('chatExport.downloadShort')}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
