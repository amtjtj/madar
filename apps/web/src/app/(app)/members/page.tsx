'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  ShieldOff,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';

import { t } from '@madar/i18n';
import {
  SYSTEM_ROLES,
  type CreateMemberResponse,
  type Member,
  type SystemRole,
  type TemporaryPasswordResponse,
} from '@madar/shared';
import {
  Avatar,
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
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { flattenTree } from '@/lib/tree';

type DeptRole = 'head' | 'manager' | 'member' | 'viewer';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; member: Member }
  | { kind: 'password'; member: Member }
  | { kind: 'twoFactor'; member: Member }
  | { kind: 'suspend'; member: Member }
  | { kind: 'temporary'; name: string; username: string | null; password: string }
  | null;

export default function MembersPage() {
  const can = useCan();
  const { data: me } = useMe();
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const deferredQuery = useDeferredValue(query.trim());
  const { data: members, isPending } = useMembers({
    q: deferredQuery || undefined,
    includeInactive,
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canManage = can('member.update');
  const myRoles = me?.member?.roles ?? [];

  const setStatus = useMutation({
    mutationFn: ({ member, status }: { member: Member; status: 'active' | 'suspended' }) =>
      api<Member>(`/api/members/${member.id}/${status === 'active' ? 'activate' : 'suspend'}`, {
        method: 'POST',
      }),
    // Optimistic status change; rolled back if the API refuses.
    onMutate: async ({ member, status }) => {
      await queryClient.cancelQueries({ queryKey: ['members'] });
      const snapshots = queryClient.getQueriesData<Member[]>({ queryKey: ['members'] });
      queryClient.setQueriesData<Member[]>({ queryKey: ['members'] }, (list) =>
        list?.map((m) => (m.id === member.id ? { ...m, status } : m)),
      );
      return { snapshots };
    },
    onError: (e, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast({ tone: 'error', title: errorMessage(e) });
    },
    onSuccess: (_data, { status }) =>
      toast({
        tone: 'success',
        title: status === 'active' ? t('members.activated') : t('members.suspended'),
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['members'] }),
  });

  const canActOn = (member: Member) => {
    if (member.id === me?.member?.id) return false;
    const roles = member.account?.roles ?? [];
    if (roles.includes('owner') && !myRoles.includes('owner')) return false;
    if (roles.includes('admin') && !myRoles.includes('owner') && !myRoles.includes('admin'))
      return false;
    return true;
  };

  return (
    <>
      <PageHeader
        title={t('members.title')}
        subtitle={t('members.subtitle')}
        action={
          can('member.create') && (
            <Button icon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'create' })}>
              {t('members.add')}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TextField
          label={t('members.search')}
          hideLabel
          type="search"
          placeholder={t('members.search')}
          icon={<Search aria-hidden />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-60 flex-1"
        />
        {canManage && (
          <CheckboxField
            label={t('members.showInactive')}
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
        )}
      </div>

      <Card>
        {isPending ? (
          <div className="flex flex-col gap-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-10 flex-1" />
              </div>
            ))}
          </div>
        ) : !members?.length ? (
          <EmptyState title={t('members.emptyTitle')} description={t('members.emptyDescription')} />
        ) : (
          <ul className="divide-y divide-line" data-testid="member-list">
            {members.map((m) => {
              const primary = m.departments.find((d) => d.isPrimary) ?? m.departments[0];
              const isMe = m.id === me?.member?.id;
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  <Avatar
                    name={m.displayName}
                    size="md"
                    className={m.status !== 'active' ? 'opacity-50' : undefined}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-ink">{m.displayName}</span>
                      {isMe && <Badge tone="primary">{t('members.you')}</Badge>}
                      {m.status === 'suspended' && (
                        <Badge tone="danger">{t('members.statusSuspended')}</Badge>
                      )}
                      {m.account?.roles
                        .filter((r) => r !== 'member')
                        .map((r) => (
                          <Badge key={r} tone="info">
                            {t(`roles.${r as SystemRole}`)}
                          </Badge>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                      {m.title && <span>{m.title}</span>}
                      {m.title && primary && <span aria-hidden>·</span>}
                      {primary && <span>{primary.name}</span>}
                      {m.account?.username && (
                        <span dir="ltr" className="font-mono text-xs text-ink-subtle">
                          {m.account.username}
                        </span>
                      )}
                      {m.account?.mustChangePassword && (
                        <Badge tone="warning">{t('members.mustChange')}</Badge>
                      )}
                      {m.account?.twoFactorEnabled && (
                        <Badge tone="success">{t('members.twoFactorOn')}</Badge>
                      )}
                    </div>
                  </div>
                  {canManage && canActOn(m) && (
                    <Menu
                      label={m.displayName}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${t('members.actions')}: ${m.displayName}`}
                        >
                          <MoreVertical aria-hidden />
                        </Button>
                      }
                      items={[
                        {
                          key: 'edit',
                          label: t('members.edit'),
                          icon: <Pencil aria-hidden />,
                          onSelect: () => setDialog({ kind: 'edit', member: m }),
                        },
                        ...(can('member.reset_credentials')
                          ? [
                              {
                                key: 'password',
                                label: t('members.resetPassword'),
                                icon: <KeyRound aria-hidden />,
                                onSelect: () => setDialog({ kind: 'password', member: m }),
                              },
                              ...(m.account?.twoFactorEnabled
                                ? [
                                    {
                                      key: '2fa',
                                      label: t('members.resetTwoFactor'),
                                      icon: <ShieldOff aria-hidden />,
                                      onSelect: () => setDialog({ kind: 'twoFactor', member: m }),
                                    },
                                  ]
                                : []),
                            ]
                          : []),
                        ...(can('member.suspend')
                          ? m.status === 'active'
                            ? [
                                {
                                  key: 'suspend',
                                  label: t('members.suspend'),
                                  icon: <UserX aria-hidden />,
                                  tone: 'danger' as const,
                                  onSelect: () => setDialog({ kind: 'suspend', member: m }),
                                },
                              ]
                            : [
                                {
                                  key: 'activate',
                                  label: t('members.activate'),
                                  icon: <UserCheck aria-hidden />,
                                  onSelect: () => setStatus.mutate({ member: m, status: 'active' }),
                                },
                              ]
                          : []),
                      ]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <MemberDialog
          member={dialog.kind === 'edit' ? dialog.member : null}
          onClose={() => setDialog(null)}
          onCreated={(result) =>
            setDialog({
              kind: 'temporary',
              name: result.member.displayName,
              username: result.member.account?.username ?? null,
              password: result.temporaryPassword,
            })
          }
        />
      )}
      {dialog?.kind === 'temporary' && (
        <TemporaryPasswordDialog
          name={dialog.name}
          username={dialog.username}
          password={dialog.password}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'password' && (
        <ConfirmDialog
          title={t('members.resetPasswordTitle', { name: dialog.member.displayName })}
          body={t('members.resetPasswordBody')}
          run={() =>
            api<TemporaryPasswordResponse>(`/api/members/${dialog.member.id}/reset-password`, {
              method: 'POST',
            })
          }
          onDone={(result) =>
            setDialog({
              kind: 'temporary',
              name: dialog.member.displayName,
              username: dialog.member.account?.username ?? null,
              password: (result as TemporaryPasswordResponse).temporaryPassword,
            })
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'twoFactor' && (
        <ConfirmDialog
          title={t('members.resetTwoFactorTitle', { name: dialog.member.displayName })}
          body={t('members.resetTwoFactorBody')}
          run={() => api(`/api/members/${dialog.member.id}/reset-2fa`, { method: 'POST' })}
          onDone={() => {
            toast({ tone: 'success', title: t('members.twoFactorReset') });
            void queryClient.invalidateQueries({ queryKey: ['members'] });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'suspend' && (
        <ConfirmDialog
          title={t('members.suspendTitle', { name: dialog.member.displayName })}
          body={t('members.suspendBody')}
          danger
          run={async () => {
            setStatus.mutate({ member: dialog.member, status: 'suspended' });
          }}
          onDone={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function MemberDialog({
  member,
  onClose,
  onCreated,
}: {
  member: Member | null;
  onClose: () => void;
  onCreated: (result: CreateMemberResponse) => void;
}) {
  const can = useCan();
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const { data: allMembers } = useMembers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const primary = member?.departments.find((d) => d.isPrimary) ?? member?.departments[0];

  const [displayName, setDisplayName] = useState(member?.displayName ?? '');
  const [username, setUsername] = useState('');
  const [title, setTitle] = useState(member?.title ?? '');
  const [role, setRole] = useState<SystemRole>(
    (SYSTEM_ROLES.find((r) => r !== 'member' && member?.account?.roles.includes(r)) ??
      'member') as SystemRole,
  );
  const [departmentId, setDepartmentId] = useState(primary?.departmentId ?? '');
  const [deptRole, setDeptRole] = useState<DeptRole>((primary?.deptRole as DeptRole) ?? 'member');
  const [managerId, setManagerId] = useState(member?.managerId ?? '');
  const [error, setError] = useState<string | null>(null);

  const myRoles = me?.member?.roles ?? [];
  const canChangeRole = can('member.change_role');
  const assignable = SYSTEM_ROLES.filter((r) => {
    if (!canChangeRole) return r === 'member';
    if (r === 'owner') return myRoles.includes('owner');
    if (r === 'admin') return myRoles.includes('owner') || myRoles.includes('admin');
    return true;
  });

  const save = useMutation<Member | CreateMemberResponse>({
    mutationFn: () => {
      const departmentsBody = departmentId ? [{ departmentId, deptRole, isPrimary: true }] : [];
      const roles = role === 'member' ? ['member'] : [role, 'member'];
      if (member) {
        const otherDepartments = member.departments
          .filter((d) => d.departmentId !== departmentId && !d.isPrimary)
          .map(({ departmentId: id, deptRole: r }) => ({
            departmentId: id,
            deptRole: r,
            isPrimary: false,
          }));
        return api<Member>(`/api/members/${member.id}`, {
          method: 'PATCH',
          body: {
            displayName,
            title: title || null,
            managerId: managerId || null,
            departments: [...departmentsBody, ...otherDepartments],
            ...(canChangeRole ? { roles } : {}),
          },
        });
      }
      return api<CreateMemberResponse>('/api/members', {
        method: 'POST',
        body: {
          displayName,
          username,
          title: title || null,
          roles,
          departments: departmentsBody,
          managerId: managerId || null,
        },
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      await queryClient.invalidateQueries({ queryKey: keys.departments });
      await queryClient.invalidateQueries({ queryKey: keys.orgChart });
      if (member) {
        toast({ tone: 'success', title: t('members.updated') });
        onClose();
      } else {
        toast({ tone: 'success', title: t('members.created') });
        onCreated(result as CreateMemberResponse);
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const departmentOptions = [
    { value: '', label: t('members.noDepartment') },
    ...flattenTree(departments ?? [], (d) => d.parentId).map(({ item, depth }) => ({
      value: item.id,
      label: `${'— '.repeat(depth)}${item.name}`,
    })),
  ];
  const managerOptions = [
    { value: '', label: t('members.noManager') },
    ...(allMembers ?? [])
      .filter((m) => m.id !== member?.id)
      .map((m) => ({ value: m.id, label: m.displayName })),
  ];
  const valid =
    displayName.trim().length >= 2 &&
    (member || /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/i.test(username.trim()));

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        member ? t('members.editTitle', { name: member.displayName }) : t('members.createTitle')
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('members.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('members.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <FormError message={error} />
        <TextField
          label={t('members.displayName')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          autoFocus
        />
        {!member && (
          <TextField
            label={t('members.username')}
            hint={t('members.usernameHint')}
            dir="ltr"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        )}
        <TextField
          label={t('members.jobTitle')}
          placeholder={t('members.jobTitlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <SelectField
          label={t('members.role')}
          hint={t(`roleHints.${role}`)}
          options={assignable.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
          value={role}
          onChange={(e) => setRole(e.target.value as SystemRole)}
          disabled={assignable.length === 1}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t('members.department')}
            options={departmentOptions}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          />
          <SelectField
            label={t('members.deptRole')}
            options={(['member', 'manager', 'head', 'viewer'] as const).map((r) => ({
              value: r,
              label: t(`deptRoles.${r}`),
            }))}
            value={deptRole}
            onChange={(e) => setDeptRole(e.target.value as DeptRole)}
            disabled={!departmentId}
          />
        </div>
        <SelectField
          label={t('members.manager')}
          options={managerOptions}
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function TemporaryPasswordDialog({
  name,
  username,
  password,
  onClose,
}: {
  name: string;
  username: string | null;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(username ? `${username}\n${password}` : password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable: the values stay visible
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('members.tempPasswordTitle', { name })}
      description={t('members.tempPasswordBody')}
      footer={<Button onClick={onClose}>{t('members.gotIt')}</Button>}
    >
      <dl className="flex flex-col gap-3 rounded-xl bg-sunken p-4">
        {username && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-sm text-ink-muted">{t('members.tempPasswordUsername')}</dt>
            <dd dir="ltr" className="font-mono font-bold text-ink">
              {username}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-sm text-ink-muted">{t('members.tempPasswordLabel')}</dt>
          <dd
            dir="ltr"
            className="font-mono text-lg font-bold text-ink"
            data-testid="temporary-password"
          >
            {password}
          </dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        size="sm"
        onClick={copy}
        icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        className="self-start"
      >
        {copied ? t('members.copied') : t('members.copy')}
      </Button>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  body,
  danger,
  run,
  onDone,
  onClose,
}: {
  title: string;
  body: string;
  danger?: boolean;
  run: () => Promise<unknown>;
  onDone: (result: unknown) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('members.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('members.confirm')}
          </Button>
        </>
      }
    >
      <FormError message={error} />
    </Modal>
  );
}
