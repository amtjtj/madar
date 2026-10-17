'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Eye, MoreVertical, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import {
  formatNumber,
  OVERSIGHT_RESOURCES,
  type Department,
  type OversightResource,
} from '@madar/shared';
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  EmptyState,
  Menu,
  Modal,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { FormError } from '@/components/forms/form-error';
import { keys, useCan, useDepartments, useMembers } from '@/hooks/queries';
import { ME_KEY } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { descendantIds, flattenTree } from '@/lib/tree';

type Dialog =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'edit'; department: Department }
  | { kind: 'oversight'; department: Department }
  | { kind: 'archive'; department: Department }
  | null;

export default function DepartmentsPage() {
  const can = useCan();
  const { data: departments, isPending } = useDepartments();
  const [dialog, setDialog] = useState<Dialog>(null);
  const canManage = can('department.manage');
  const canOversee = can('department.set_oversight');

  const rows = flattenTree(departments ?? [], (d) => d.parentId);

  return (
    <>
      <PageHeader
        title={t('departments.title')}
        subtitle={t('departments.subtitle')}
        action={
          canManage && (
            <Button
              icon={<Plus aria-hidden />}
              onClick={() => setDialog({ kind: 'create', parentId: null })}
            >
              {t('departments.add')}
            </Button>
          )
        }
      />

      <Card>
        {isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('departments.emptyTitle')}
            description={t('departments.emptyDescription')}
            action={
              canManage && (
                <Button
                  icon={<Plus aria-hidden />}
                  onClick={() => setDialog({ kind: 'create', parentId: null })}
                >
                  {t('departments.add')}
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-line" data-testid="department-list">
            {rows.map(({ item: d, depth }) => (
              <li
                key={d.id}
                className="flex items-center gap-3 py-3.5 pe-3"
                style={{ paddingInlineStart: `${1.25 + depth * 1.5}rem` }}
              >
                {depth > 0 && <span aria-hidden className="-ms-3 h-px w-3 bg-line-strong" />}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-ink">{d.name}</span>
                    {d.oversight.length > 0 && (
                      <Badge
                        tone="accent"
                        title={d.oversight.map((r) => t(`oversight.${r}`)).join('، ')}
                      >
                        <Eye aria-hidden />
                        {t('departments.oversightBadge')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                    <span>{d.head ? d.head.displayName : t('departments.noHead')}</span>
                    <span aria-hidden>·</span>
                    <span>{t('departments.members', { count: formatNumber(d.memberCount) })}</span>
                  </div>
                </div>
                {(canManage || canOversee) && (
                  <Menu
                    label={d.name}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${t('members.actions')}: ${d.name}`}
                      >
                        <MoreVertical aria-hidden />
                      </Button>
                    }
                    items={[
                      ...(canManage
                        ? [
                            {
                              key: 'edit',
                              label: t('departments.edit'),
                              icon: <Pencil aria-hidden />,
                              onSelect: () => setDialog({ kind: 'edit', department: d }),
                            },
                            {
                              key: 'child',
                              label: t('departments.addChild'),
                              icon: <Plus aria-hidden />,
                              onSelect: () => setDialog({ kind: 'create', parentId: d.id }),
                            },
                          ]
                        : []),
                      ...(canOversee
                        ? [
                            {
                              key: 'oversight',
                              label: t('departments.oversight'),
                              icon: <ShieldCheck aria-hidden />,
                              onSelect: () => setDialog({ kind: 'oversight', department: d }),
                            },
                          ]
                        : []),
                      ...(canManage
                        ? [
                            {
                              key: 'archive',
                              label: t('departments.archive'),
                              icon: <Archive aria-hidden />,
                              tone: 'danger' as const,
                              onSelect: () => setDialog({ kind: 'archive', department: d }),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog && (dialog.kind === 'create' || dialog.kind === 'edit') && (
        <DepartmentDialog
          key={dialog.kind === 'edit' ? dialog.department.id : `new-${dialog.parentId}`}
          departments={departments ?? []}
          department={dialog.kind === 'edit' ? dialog.department : null}
          parentId={dialog.kind === 'create' ? dialog.parentId : null}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'oversight' && (
        <OversightDialog department={dialog.department} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveDialog department={dialog.department} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function DepartmentDialog({
  departments,
  department,
  parentId,
  onClose,
}: {
  departments: Department[];
  department: Department | null;
  parentId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: members } = useMembers();
  const [name, setName] = useState(department?.name ?? '');
  const [parent, setParent] = useState(department?.parentId ?? parentId ?? '');
  const [head, setHead] = useState(department?.head?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  const excluded = department
    ? descendantIds(departments, (d) => d.parentId, department.id)
    : new Set<string>();
  const parentOptions = [
    { value: '', label: t('departments.noParent') },
    ...flattenTree(departments, (d) => d.parentId)
      .filter(({ item }) => !excluded.has(item.id))
      .map(({ item, depth }) => ({ value: item.id, label: `${'— '.repeat(depth)}${item.name}` })),
  ];
  const headOptions = [
    { value: '', label: t('departments.noHead') },
    ...(members ?? []).map((m) => ({ value: m.id, label: m.displayName })),
  ];

  const save = useMutation({
    mutationFn: () => {
      const body = { name, parentId: parent || null, headMemberId: head || null };
      return department
        ? api<Department>(`/api/departments/${department.id}`, { method: 'PATCH', body })
        : api<Department>('/api/departments', { method: 'POST', body });
    },
    onSuccess: async () => {
      toast({
        tone: 'success',
        title: department ? t('departments.updated') : t('departments.created'),
      });
      onClose();
      await queryClient.invalidateQueries({ queryKey: keys.departments });
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={department ? t('departments.editTitle') : t('departments.createTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('departments.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            {t('departments.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length >= 2) save.mutate();
        }}
      >
        <FormError message={error} />
        <TextField
          label={t('departments.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <SelectField
          label={t('departments.parent')}
          options={parentOptions}
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        />
        <SelectField
          label={t('departments.head')}
          options={headOptions}
          value={head}
          onChange={(e) => setHead(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function OversightDialog({ department, onClose }: { department: Department; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<OversightResource>>(new Set(department.oversight));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (resources: OversightResource[]) =>
      api<Department>(`/api/departments/${department.id}/oversight`, {
        method: 'PUT',
        body: { resources },
      }),
    // Optimistic: show the new badge immediately; roll back on failure.
    onMutate: async (resources) => {
      await queryClient.cancelQueries({ queryKey: keys.departments });
      const previous = queryClient.getQueryData<Department[]>(keys.departments);
      queryClient.setQueryData<Department[]>(keys.departments, (list) =>
        list?.map((d) => (d.id === department.id ? { ...d, oversight: resources } : d)),
      );
      onClose();
      return { previous };
    },
    onError: (e, _vars, context) => {
      queryClient.setQueryData(keys.departments, context?.previous);
      toast({ tone: 'error', title: errorMessage(e) });
      setError(errorMessage(e));
    },
    onSuccess: () => toast({ tone: 'success', title: t('departments.updated') }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.departments });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('departments.oversightTitle', { name: department.name })}
      description={t('departments.oversightBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('departments.cancel')}
          </Button>
          <Button onClick={() => save.mutate([...selected])}>{t('departments.save')}</Button>
        </>
      }
    >
      <FormError message={error} />
      <div className="grid gap-1 sm:grid-cols-2">
        {OVERSIGHT_RESOURCES.map((resource) => (
          <CheckboxField
            key={resource}
            label={t(`oversight.${resource}`)}
            checked={selected.has(resource)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(resource);
              else next.delete(resource);
              setSelected(next);
            }}
          />
        ))}
      </div>
    </Modal>
  );
}

function ArchiveDialog({ department, onClose }: { department: Department; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: () => api(`/api/departments/${department.id}/archive`, { method: 'POST' }),
    onSuccess: async () => {
      toast({ tone: 'success', title: t('departments.archived') });
      onClose();
      await queryClient.invalidateQueries({ queryKey: keys.departments });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('departments.archiveTitle', { name: department.name })}
      description={t('departments.archiveBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('departments.cancel')}
          </Button>
          <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate()}>
            {t('departments.archiveConfirm')}
          </Button>
        </>
      }
    >
      <FormError message={error} />
    </Modal>
  );
}
