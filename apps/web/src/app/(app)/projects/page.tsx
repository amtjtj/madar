'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { t } from '@madar/i18n';
import { Badge, Card, EmptyState, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { NewProjectButton } from '@/components/work/new-project-button';
import { ProjectCard } from '@/components/work/project-card';
import { useProjects } from '@/hooks/work';

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsScreen />
    </Suspense>
  );
}

function ProjectsScreen() {
  const risk = useSearchParams().get('risk') === 'true';
  const { data: projects, isPending } = useProjects({ risk });
  return (
    <>
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        action={<NewProjectButton />}
      />
      {risk && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="status">
          <span className="text-sm text-ink-muted">{t('tasks.filters.label')}</span>
          <Badge tone="warning">{t('projects.atRisk')}</Badge>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-ink-muted hover:bg-sunken [&_svg]:size-4"
          >
            <X aria-hidden />
            {t('tasks.filters.clear')}
          </Link>
        </div>
      )}
      {isPending || !projects ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            title={risk ? t('projects.noneAtRisk') : t('projects.emptyTitle')}
            description={risk ? t('projects.noneAtRiskHint') : t('projects.emptyDescription')}
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
