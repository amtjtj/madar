'use client';

import { Search, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { t } from '@madar/i18n';
import { PROJECT_ROLES, type Member, type Project, type ProjectRole } from '@madar/shared';
import {
  Avatar,
  Badge,
  Button,
  Modal,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@madar/ui';

import { useMembers } from '@/hooks/queries';
import { useSetProjectMembers } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/** «Title، department» under a name; nothing when the directory has neither. */
function detailOf(member: Pick<Member, 'title' | 'departments'> | undefined): string {
  if (!member) return '';
  const department = member.departments.find((d) => d.isPrimary) ?? member.departments[0];
  return [member.title, department?.name].filter(Boolean).join('، ');
}

/**
 * Project members (plan phase-2-step-10b): search anyone in the company by name, set each
 * person's role (owner, member, observer) or remove them. The creator always stays the owner.
 */
export function ProjectMembers({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const setMembers = useSetProjectMembers();
  const { toast } = useToast();
  // A short pause before searching, so typing a name sends one request.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data: directory } = useMembers();
  const { data: found, isFetching } = useMembers({ q: search });
  const byId = new Map((directory ?? []).map((m) => [m.id, m]));

  const current = project.members.map((m) => ({ memberId: m.id, role: m.role }));
  const save = (next: Array<{ memberId: string; role: ProjectRole }>) =>
    setMembers.mutate(
      { id: project.id, members: next },
      { onError: (error) => toast({ tone: 'error', title: errorMessage(error) }) },
    );
  const results = search
    ? (found ?? [])
        .filter((m) => m.status === 'active' && !project.members.some((pm) => pm.id === m.id))
        .slice(0, 8)
    : [];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      title={t('projects.manageMembers')}
      trigger={
        <Button size="sm" variant="secondary" icon={<UserPlus aria-hidden />}>
          {t('projects.members')}
        </Button>
      }
    >
      <TextField
        label={t('projects.searchMembers')}
        hideLabel
        type="search"
        placeholder={t('projects.searchPlaceholder')}
        icon={<Search aria-hidden />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {search && (
        <section aria-label={t('projects.searchResults')} className="flex flex-col gap-1">
          {isFetching && !found ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : results.length === 0 ? (
            <p className="py-2 text-sm text-ink-muted">{t('projects.noResults')}</p>
          ) : (
            <ul className="flex flex-col">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-label={t('projects.addPerson', { name: m.displayName })}
                    onClick={() => {
                      save([...current, { memberId: m.id, role: 'member' }]);
                      setQuery('');
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Avatar name={m.displayName} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium text-ink">{m.displayName}</span>
                      <span className="truncate text-xs text-ink-muted">{detailOf(m)}</span>
                    </span>
                    <UserPlus aria-hidden className="size-4 text-primary-ink" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ul aria-label={t('projects.members')} className="flex flex-col divide-y divide-line">
        {project.members.map((m) => {
          const creator = m.id === project.owner.id;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Avatar name={m.displayName} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium text-ink">{m.displayName}</span>
                <span className="truncate text-xs text-ink-muted">{detailOf(byId.get(m.id))}</span>
              </span>
              {creator ? (
                <Badge tone="primary">{t('projects.roles.owner')}</Badge>
              ) : (
                <div className="flex items-center gap-1">
                  <SelectField
                    label={t('projects.roleOf', { name: m.displayName })}
                    hideLabel
                    value={m.role}
                    onChange={(e) =>
                      save(
                        current.map((c) =>
                          c.memberId === m.id ? { ...c, role: e.target.value as ProjectRole } : c,
                        ),
                      )
                    }
                    options={PROJECT_ROLES.map((role) => ({
                      value: role,
                      label: t(`projects.roles.${role}`),
                    }))}
                  />
                  <button
                    type="button"
                    aria-label={t('projects.removeMember', { name: m.displayName })}
                    onClick={() => save(current.filter((c) => c.memberId !== m.id))}
                    className="grid size-10 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
                  >
                    <X aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {project.members.length <= 1 && (
        <p className="text-sm text-ink-muted">{t('projects.onlyYou')}</p>
      )}
      <p className="text-xs text-ink-subtle">{t('projects.rolesHint')}</p>
    </Modal>
  );
}
