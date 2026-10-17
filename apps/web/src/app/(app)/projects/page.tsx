'use client';

import { t } from '@madar/i18n';
import { Card, EmptyState, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { NewProjectButton } from '@/components/work/new-project-button';
import { ProjectCard } from '@/components/work/project-card';
import { useProjects } from '@/hooks/work';

export default function ProjectsPage() {
  const { data: projects, isPending } = useProjects();
  return (
    <>
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        action={<NewProjectButton />}
      />
      {isPending || !projects ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            title={t('projects.emptyTitle')}
            description={t('projects.emptyDescription')}
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
