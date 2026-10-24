import { t } from '@madar/i18n';
import { formatNumber, type RequestKind, type RequestStatus } from '@madar/shared';
import { Check, Clock, FileText, Palmtree, Receipt, X } from 'lucide-react';

import { cn } from '../lib/cn.js';
import { Avatar } from './avatar.js';
import { Badge } from './badge.js';
import type { LinkComponent } from './navigation.js';

const kindIcon = { leave: Palmtree, expense: Receipt, general: FileText } as const;
const kindTone = { leave: 'accent', expense: 'info', general: 'neutral' } as const;
const statusTone = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  canceled: 'neutral',
} as const;

/** «مرخصی», «هزینه» or «درخواست» (plan phase-3-step-17b). */
export function RequestKindBadge({ kind, className }: { kind: RequestKind; className?: string }) {
  const Icon = kindIcon[kind];
  return (
    <Badge tone={kindTone[kind]} className={className}>
      <Icon aria-hidden />
      {t(`ui.request.kinds.${kind}`)}
    </Badge>
  );
}

/** «در انتظار», «تایید شد», «رد شد» or «لغو شد». */
export function RequestStatusBadge({
  status,
  className,
}: {
  status: RequestStatus;
  className?: string;
}) {
  return (
    <Badge tone={statusTone[status]} dot={status === 'pending'} className={className}>
      {t(`ui.request.statuses.${status}`)}
    </Badge>
  );
}

/** An amount in tomans with Persian digits and grouping: «۱۸٬۰۰۰٬۰۰۰ تومان». */
export function AmountText({ toman, className }: { toman: number; className?: string }) {
  return (
    <span className={cn('tabular-nums', className)}>
      {t('ui.request.toman', { amount: formatNumber(toman) })}
    </span>
  );
}

export interface RequestRowProps {
  href: string;
  kind: RequestKind;
  /** Already worded (a leave's dates, an expense's category, a request's own title). */
  title: string;
  status: RequestStatus;
  /** Who made it (shown to approvers) or whose turn it is (shown to the requester). */
  person?: string | null;
  /** «۳ روز پیش». */
  when: string;
  amountToman?: number | null;
  Link?: LinkComponent;
  className?: string;
}

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

/** One request in the inbox: kind, title, who, when, and its state. */
export function RequestRow({
  href,
  kind,
  title,
  status,
  person,
  when,
  amountToman,
  Link = DefaultLink,
  className,
}: RequestRowProps) {
  const Icon = kindIcon[kind];
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-16 items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus',
        className,
      )}
    >
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">
        <Icon aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">
          {person ? `${person}، ${when}` : when}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <RequestKindBadge kind={kind} />
          <RequestStatusBadge status={status} />
          {amountToman != null && (
            <AmountText toman={amountToman} className="text-xs text-ink-muted" />
          )}
        </span>
      </span>
    </Link>
  );
}

export interface ApprovalStepView {
  approver: string;
  decision: 'approved' | 'rejected' | null;
  comment?: string | null;
  /** «۲ آبان، ۱۰:۳۰». */
  when?: string | null;
  /** Decided by someone standing in for the approver. */
  decidedBy?: string | null;
  /** The step the request waits on now. */
  current?: boolean;
}

/** The approval steps in order: who, what they decided, when and why. */
export function ApprovalTimeline({
  steps,
  className,
}: {
  steps: ApprovalStepView[];
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col gap-0', className)} aria-label={t('ui.request.steps')}>
      {steps.map((step, i) => {
        const Icon =
          step.decision === 'approved' ? Check : step.decision === 'rejected' ? X : Clock;
        return (
          <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute start-5 top-11 bottom-0 w-px bg-line" />
            )}
            <span
              className={cn(
                'relative grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-5',
                step.decision === 'approved' && 'bg-success-soft text-success-ink',
                step.decision === 'rejected' && 'bg-danger-soft text-danger-ink',
                !step.decision && step.current && 'bg-warning-soft text-warning-ink',
                !step.decision && !step.current && 'bg-sunken text-ink-subtle',
              )}
            >
              <Icon aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <Avatar name={step.approver} size="sm" />
                <span className="font-medium text-ink">{step.approver}</span>
                <span className="text-sm text-ink-muted">
                  {step.decision
                    ? t(`ui.request.decisions.${step.decision}`)
                    : step.current
                      ? t('ui.request.waiting')
                      : t('ui.request.later')}
                </span>
              </div>
              {step.decidedBy && (
                <p className="text-xs text-ink-subtle">
                  {t('ui.request.standIn', { name: step.decidedBy })}
                </p>
              )}
              {step.comment && (
                <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink">{step.comment}</p>
              )}
              {step.when && <p className="text-xs text-ink-subtle">{step.when}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
