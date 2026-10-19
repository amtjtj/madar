import { FolderKanban, Lock, Users } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { formatCalendarDate, formatNumber, type Project } from '@madar/shared';
import { AvatarGroup, Badge, Card, ProgressBar } from '@madar/ui';

export function ProjectCard({ project }: { project: Project }) {
  const { done, total, progress } = project.tasks;
  return (
    <Card interactive className="p-0">
      <Link href={`/projects/${project.id}`} className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">
            <FolderKanban aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="truncate text-lg font-bold text-ink">{project.name}</h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              {project.department && <span>{project.department.name}</span>}
              <Badge tone={project.visibility === 'private' ? 'warning' : 'neutral'}>
                {project.visibility === 'private' ? <Lock aria-hidden /> : <Users aria-hidden />}
                {t(`projects.visibilities.${project.visibility}`)}
              </Badge>
              {project.dueOn && <span>{formatCalendarDate(project.dueOn)}</span>}
            </div>
          </div>
        </div>
        {/* Weighted progress of the project's tasks (ADR 0018); the count stays below it. */}
        <ProgressBar
          value={progress}
          label={t('projects.progress', { done: formatNumber(done), total: formatNumber(total) })}
          showValue={total > 0}
        />
        <AvatarGroup people={project.members.map((m) => ({ name: m.displayName }))} size="xs" />
      </Link>
    </Card>
  );
}
