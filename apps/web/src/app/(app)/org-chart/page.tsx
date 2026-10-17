'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, type OrgChartNode } from '@madar/shared';
import { Avatar, Card, EmptyState, Skeleton, cn } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useOrgChart } from '@/hooks/queries';

export default function OrgChartPage() {
  const { data: nodes, isPending } = useOrgChart();
  const ids = new Set(nodes?.map((n) => n.id));
  const childrenOf = new Map<string | null, OrgChartNode[]>();
  for (const node of nodes ?? []) {
    const parent = node.managerId && ids.has(node.managerId) ? node.managerId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
  }
  const roots = childrenOf.get(null) ?? [];
  const hasStructure = (nodes ?? []).some((n) => n.managerId);

  return (
    <>
      <PageHeader title={t('orgChart.title')} subtitle={t('orgChart.subtitle')} />
      {isPending ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full max-w-md rounded-xl" />
          ))}
        </div>
      ) : !hasStructure ? (
        <Card>
          <EmptyState
            title={t('orgChart.emptyTitle')}
            description={t('orgChart.emptyDescription')}
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" role="tree" aria-label={t('orgChart.title')}>
          {roots.map((node) => (
            <OrgNode key={node.id} node={node} childrenOf={childrenOf} depth={0} />
          ))}
        </ul>
      )}
    </>
  );
}

function OrgNode({
  node,
  childrenOf,
  depth,
}: {
  node: OrgChartNode;
  childrenOf: Map<string | null, OrgChartNode[]>;
  depth: number;
}) {
  const reports = childrenOf.get(node.id) ?? [];
  const [open, setOpen] = useState(depth < 2);
  return (
    <li role="treeitem" aria-expanded={reports.length ? open : undefined} aria-selected={false}>
      <div className="flex max-w-md items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-xs">
        <Avatar name={node.displayName} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold text-ink">{node.displayName}</span>
          <span className="truncate text-sm text-ink-muted">
            {[node.title, node.primaryDepartment?.name].filter(Boolean).join(' · ')}
          </span>
        </div>
        {reports.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? t('orgChart.collapse') : t('orgChart.expand')}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-ink-muted hover:bg-sunken [&_svg]:size-4"
          >
            {t('orgChart.reports', { count: formatNumber(reports.length) })}
            <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && reports.length > 0 && (
        <ul role="group" className="ms-6 mt-3 flex flex-col gap-3 border-s-2 border-line ps-5">
          {reports.map((child) => (
            <OrgNode key={child.id} node={child} childrenOf={childrenOf} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
