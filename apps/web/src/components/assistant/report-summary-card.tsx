'use client';

import type { ReportScope } from '@madar/shared';
import { t } from '@madar/i18n';
import { AssistantBadge, Card, CardContent } from '@madar/ui';

import { useAiStatus, useReportSummary } from '@/hooks/ai';

/**
 * «خلاصه هفته» above a stored weekly report (ADR 0025): the assistant's draft, labelled as such.
 * Nothing at all when the assistant is off or the week is still running.
 */
export function ReportSummaryCard({
  scope,
  departmentId,
  week,
  partial,
}: {
  scope: ReportScope;
  departmentId: string | undefined;
  week: string | undefined;
  partial: boolean;
}) {
  const { data: status } = useAiStatus();
  const on = Boolean(status?.available && status.enabled) && !partial;
  const { data } = useReportSummary(scope, departmentId, week, on);
  // An older report the assistant will not summarise: no card rather than «در حال آماده شدن».
  if (!on || !data || (!data.summary && !data.pending)) return null;
  return (
    <Card className="print-avoid-break border-accent/40">
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-ink">{t('assistant.summaryTitle')}</h2>
          <AssistantBadge />
        </div>
        {data.summary ? (
          <p className="leading-8 text-ink">{data.summary.text}</p>
        ) : (
          <p className="text-sm text-ink-subtle">{t('assistant.summaryPending')}</p>
        )}
      </CardContent>
    </Card>
  );
}
