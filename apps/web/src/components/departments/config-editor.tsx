'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@madar/i18n';
import {
  allStatuses,
  FIELD_TYPES,
  formatNumber,
  moduleConfig,
  newConfigKey,
  STATUS_CATEGORIES,
  STATUS_COLORS,
  TYPE_ICONS,
  type ConfigMappings,
  type DepartmentConfigDetail,
  type FieldDef,
  type FieldType,
  type ModuleConfig,
  type StatusCategory,
  type StatusColor,
  type StatusDef,
  type TemplateKey,
  type TypeIcon as TypeIconKey,
  type WorkflowDef,
} from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckboxField,
  Modal,
  SelectField,
  SortableList,
  StatusDot,
  TextField,
  TypeIcon,
  useToast,
} from '@madar/ui';

import { useApplyTemplate, useSaveConfig, useTemplates } from '@/hooks/module-config';
import { errorMessage } from '@/lib/errors';

import { TemplatePicker } from './template-picker';

/**
 * The department config editor (plan phase-3-step-19a). Everything is edited in a draft and saved
 * at once; removing a status or type that still has work asks where that work goes. Keys are made
 * here and never shown; a kept status keeps its category and a kept field its type.
 */
export function ConfigEditor({
  detail: latest,
  canEdit,
}: {
  detail: DepartmentConfigDetail;
  canEdit: boolean;
}) {
  // The version the draft started from; a newer one (another admin) never wipes unsaved work.
  const [detail, setBase] = useState(latest);
  const [draft, setDraft] = useState<ModuleConfig>(() => structuredClone(latest.config));
  const restart = (fresh: DepartmentConfigDetail) => {
    setBase(fresh);
    setDraft(structuredClone(fresh.config));
  };
  const [mappingFor, setMappingFor] = useState<{
    next: ModuleConfig;
    templateKey?: TemplateKey;
  } | null>(null);
  const save = useSaveConfig(detail.departmentId);
  const apply = useApplyTemplate(detail.departmentId);
  const { toast } = useToast();

  const dirty = JSON.stringify(draft) !== JSON.stringify(detail.config);
  const stale = latest.version !== detail.version;
  // Nothing to lose: follow the newer version straight away.
  if (stale && !dirty) restart(latest);
  const valid = moduleConfig.safeParse(draft).success;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const known = useMemo(
    () => ({
      statuses: new Set(allStatuses(detail.config).map((s) => s.key)),
      fields: new Set(detail.config.fields.map((f) => f.key)),
    }),
    [detail.config],
  );

  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });
  const send = (next: ModuleConfig, mappings: ConfigMappings, templateKey?: TemplateKey) => {
    const done = (fresh: DepartmentConfigDetail) => {
      restart(fresh);
      setMappingFor(null);
      toast({
        tone: 'success',
        title: templateKey ? t('departmentConfig.applied') : t('departmentConfig.saved'),
      });
    };
    if (templateKey) {
      apply.mutate(
        { version: detail.version, templateKey, mappings },
        { onSuccess: done, onError },
      );
    } else {
      save.mutate(
        { version: detail.version, config: next, mappings },
        { onSuccess: done, onError },
      );
    }
  };
  /** Save straight away, or first ask where the work of removed statuses and types goes. */
  const submit = (next: ModuleConfig, templateKey?: TemplateKey) => {
    if (needsMapping(detail, next)) setMappingFor({ next, templateKey });
    else send(next, { statuses: {}, types: {} }, templateKey);
  };

  const workflow = draft.workflows[0] as WorkflowDef;
  const setWorkflow = (statuses: StatusDef[]) =>
    setDraft((d) => ({ ...d, workflows: [{ ...workflow, statuses }, ...d.workflows.slice(1)] }));
  const setStatus = (key: string, patch: Partial<StatusDef>) =>
    setWorkflow(workflow.statuses.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const takenKeys = () => [
    ...allStatuses(draft).map((s) => s.key),
    ...draft.workItemTypes.map((w) => w.key),
    ...draft.fields.map((f) => f.key),
  ];
  const setField = (key: string, patch: Partial<FieldDef>) =>
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    }));

  return (
    <div className="flex flex-col gap-4 pb-28">
      {stale && dirty && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-ink"
        >
          <p className="min-w-0 flex-1">{t('departmentConfig.changedElsewhere')}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => restart(latest)}>
            {t('departmentConfig.reload')}
          </Button>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('departmentConfig.vocabulary.title')}</CardTitle>
          <CardDescription>{t('departmentConfig.vocabulary.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(['task', 'taskPlural', 'project', 'projectPlural'] as const).map((word) => (
            <TextField
              key={word}
              label={t(`departmentConfig.vocabulary.${word}`)}
              value={draft.vocabulary[word]}
              maxLength={40}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, vocabulary: { ...d.vocabulary, [word]: e.target.value } }))
              }
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('departmentConfig.statuses.title')}</CardTitle>
          <CardDescription>{t('departmentConfig.statuses.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SortableList
            label={t('departmentConfig.statuses.list')}
            items={workflow.statuses.map((s) => ({ ...s, id: s.key }))}
            itemTitle={(s) => s.label || t('departmentConfig.untitled')}
            onReorder={(ids) =>
              setWorkflow(
                ids
                  .map((id) => workflow.statuses.find((s) => s.key === id))
                  .filter((s): s is StatusDef => Boolean(s)),
              )
            }
            renderItem={(status, handle) => (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
                {canEdit && handle}
                <StatusDot color={status.color} className="mb-4" />
                <TextField
                  label={t('departmentConfig.statuses.label')}
                  value={status.label}
                  maxLength={40}
                  disabled={!canEdit}
                  onChange={(e) => setStatus(status.key, { label: e.target.value })}
                  className="min-w-36 flex-1"
                  hint={
                    detail.usage.statuses[status.key]
                      ? t('departmentConfig.statuses.inUse', {
                          count: formatNumber(detail.usage.statuses[status.key] ?? 0),
                        })
                      : undefined
                  }
                />
                <SelectField
                  label={t('departmentConfig.statuses.category')}
                  value={status.category}
                  disabled={!canEdit || known.statuses.has(status.key)}
                  onChange={(e) =>
                    setStatus(status.key, { category: e.target.value as StatusCategory })
                  }
                  options={STATUS_CATEGORIES.map((c) => ({
                    value: c,
                    label: t(`departmentConfig.categories.${c}`),
                  }))}
                  className="w-32"
                />
                <SelectField
                  label={t('departmentConfig.statuses.color')}
                  value={status.color}
                  disabled={!canEdit}
                  onChange={(e) => setStatus(status.key, { color: e.target.value as StatusColor })}
                  options={STATUS_COLORS.map((c) => ({
                    value: c,
                    label: t(`departmentConfig.colors.${c}`),
                  }))}
                  className="w-32"
                />
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('departmentConfig.statuses.remove', { name: status.label })}
                    disabled={workflow.statuses.length <= 2}
                    onClick={() =>
                      setWorkflow(workflow.statuses.filter((s) => s.key !== status.key))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            )}
          />
          {canEdit && workflow.statuses.length < 12 && (
            <Button
              type="button"
              variant="secondary"
              icon={<Plus aria-hidden />}
              className="self-start"
              onClick={() =>
                setWorkflow([
                  ...workflow.statuses,
                  {
                    key: newConfigKey('s', takenKeys()),
                    label: '',
                    category: 'in_progress',
                    color: 'blue',
                  },
                ])
              }
            >
              {t('departmentConfig.statuses.add')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('departmentConfig.types.title')}</CardTitle>
          <CardDescription>{t('departmentConfig.types.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {draft.workItemTypes.map((type) => {
            const setType = (patch: Partial<typeof type>) =>
              setDraft((d) => ({
                ...d,
                workItemTypes: d.workItemTypes.map((w) =>
                  w.key === type.key ? { ...w, ...patch } : w,
                ),
              }));
            return (
              <div key={type.key} className="flex flex-col gap-3 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <TypeIcon icon={type.icon} className="mb-3.5 size-5 text-ink-muted" />
                  <TextField
                    label={t('departmentConfig.types.label')}
                    value={type.label}
                    maxLength={40}
                    disabled={!canEdit}
                    onChange={(e) => setType({ label: e.target.value })}
                    className="min-w-36 flex-1"
                  />
                  <SelectField
                    label={t('departmentConfig.types.icon')}
                    value={type.icon}
                    disabled={!canEdit}
                    onChange={(e) => setType({ icon: e.target.value as TypeIconKey })}
                    options={TYPE_ICONS.map((i) => ({
                      value: i,
                      label: t(`departmentConfig.icons.${i}`),
                    }))}
                    className="w-32"
                  />
                  <SelectField
                    label={t('departmentConfig.types.weight')}
                    value={String(type.defaultWeight)}
                    disabled={!canEdit}
                    onChange={(e) => setType({ defaultWeight: Number(e.target.value) })}
                    options={(['1', '2', '3', '4', '5'] as const).map((w) => ({
                      value: w,
                      label: t(`task.weights.${w}`),
                    }))}
                    className="w-36"
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('departmentConfig.types.remove', { name: type.label })}
                      disabled={draft.workItemTypes.length <= 1}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          workItemTypes: d.workItemTypes.filter((w) => w.key !== type.key),
                        }))
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-sm font-medium text-ink">
                    {t('departmentConfig.types.fields')}
                  </legend>
                  {draft.fields.length === 0 ? (
                    <p className="text-sm text-ink-subtle">
                      {t('departmentConfig.types.noFields')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {draft.fields.map((field) => (
                        <CheckboxField
                          key={field.key}
                          label={field.label || t('departmentConfig.untitled')}
                          checked={type.fields.includes(field.key)}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setType({
                              fields: e.target.checked
                                ? [...type.fields, field.key]
                                : type.fields.filter((k) => k !== field.key),
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
              </div>
            );
          })}
          {canEdit && draft.workItemTypes.length < 10 && (
            <Button
              type="button"
              variant="secondary"
              icon={<Plus aria-hidden />}
              className="self-start"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  workItemTypes: [
                    ...d.workItemTypes,
                    {
                      key: newConfigKey('t', takenKeys()),
                      label: '',
                      icon: 'task',
                      workflow: workflow.key,
                      fields: [],
                      defaultWeight: 1,
                    },
                  ],
                }))
              }
            >
              {t('departmentConfig.types.add')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('departmentConfig.fields.title')}</CardTitle>
          <CardDescription>{t('departmentConfig.fields.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {draft.fields.length === 0 && (
            <p className="text-sm text-ink-subtle">{t('departmentConfig.fields.empty')}</p>
          )}
          {draft.fields.map((field) => {
            const choice = field.type === 'select' || field.type === 'multiselect';
            const options = field.options ?? [];
            return (
              <div
                key={field.key}
                className="flex flex-col gap-3 rounded-xl border border-line p-3"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <TextField
                    label={t('departmentConfig.fields.label')}
                    value={field.label}
                    maxLength={40}
                    disabled={!canEdit}
                    onChange={(e) => setField(field.key, { label: e.target.value })}
                    className="min-w-36 flex-1"
                  />
                  <SelectField
                    label={t('departmentConfig.fields.type')}
                    value={field.type}
                    disabled={!canEdit || known.fields.has(field.key)}
                    onChange={(e) => {
                      const type = e.target.value as FieldType;
                      const nowChoice = type === 'select' || type === 'multiselect';
                      setField(field.key, {
                        type,
                        options: nowChoice
                          ? (field.options ?? [{ key: newConfigKey('o', []), label: '' }])
                          : undefined,
                      });
                    }}
                    options={FIELD_TYPES.map((ft) => ({
                      value: ft,
                      label: t(`departmentConfig.fieldTypes.${ft}`),
                    }))}
                    className="w-36"
                  />
                  <CheckboxField
                    label={t('departmentConfig.fields.required')}
                    checked={field.required}
                    disabled={!canEdit}
                    onChange={(e) => setField(field.key, { required: e.target.checked })}
                    className="mb-2.5"
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('departmentConfig.fields.remove', { name: field.label })}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          fields: d.fields.filter((f) => f.key !== field.key),
                          workItemTypes: d.workItemTypes.map((w) => ({
                            ...w,
                            fields: w.fields.filter((k) => k !== field.key),
                          })),
                        }))
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                {choice && (
                  <fieldset className="flex flex-col gap-2 ps-3">
                    <legend className="mb-1 text-sm font-medium text-ink">
                      {t('departmentConfig.fields.options')}
                    </legend>
                    {options.map((option, index) => (
                      <div key={option.key} className="flex items-end gap-2">
                        <TextField
                          label={t('departmentConfig.fields.option', {
                            n: formatNumber(index + 1),
                          })}
                          hideLabel
                          placeholder={t('departmentConfig.fields.option', {
                            n: formatNumber(index + 1),
                          })}
                          value={option.label}
                          maxLength={40}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setField(field.key, {
                              options: options.map((o) =>
                                o.key === option.key ? { ...o, label: e.target.value } : o,
                              ),
                            })
                          }
                          className="flex-1"
                        />
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('departmentConfig.fields.removeOption')}
                            disabled={options.length <= 1}
                            onClick={() =>
                              setField(field.key, {
                                options: options.filter((o) => o.key !== option.key),
                              })
                            }
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </div>
                    ))}
                    {canEdit && options.length < 30 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={<Plus aria-hidden />}
                        className="self-start"
                        onClick={() =>
                          setField(field.key, {
                            options: [
                              ...options,
                              {
                                key: newConfigKey(
                                  'o',
                                  options.map((o) => o.key),
                                ),
                                label: '',
                              },
                            ],
                          })
                        }
                      >
                        {t('departmentConfig.fields.addOption')}
                      </Button>
                    )}
                  </fieldset>
                )}
              </div>
            );
          })}
          {canEdit && draft.fields.length < 30 && (
            <Button
              type="button"
              variant="secondary"
              icon={<Plus aria-hidden />}
              className="self-start"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  fields: [
                    ...d.fields,
                    {
                      key: newConfigKey('f', takenKeys()),
                      label: '',
                      type: 'text',
                      required: false,
                    },
                  ],
                }))
              }
            >
              {t('departmentConfig.fields.add')}
            </Button>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:sticky md:bottom-0 md:rounded-2xl md:border">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-muted" role="status">
              {dirty && !valid
                ? t('departmentConfig.invalid')
                : dirty
                  ? t('departmentConfig.unsaved')
                  : ''}
            </p>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(structuredClone(detail.config))}
              >
                {t('departmentConfig.discard')}
              </Button>
            )}
            <Button
              type="button"
              disabled={!dirty || !valid}
              loading={save.isPending}
              onClick={() => submit(draft)}
            >
              {t('departmentConfig.save')}
            </Button>
          </div>
        </div>
      )}

      {canEdit && !dirty && (
        <ApplyTemplate
          current={detail.templateKey}
          pending={apply.isPending}
          onApply={(key, next) => submit(next, key)}
        />
      )}

      {mappingFor && (
        <MappingDialog
          detail={detail}
          next={mappingFor.next}
          pending={save.isPending || apply.isPending}
          onCancel={() => setMappingFor(null)}
          onConfirm={(mappings) => send(mappingFor.next, mappings, mappingFor.templateKey)}
        />
      )}
    </div>
  );
}

/** Statuses and types with work that the next config no longer has. */
function gone(detail: DepartmentConfigDetail, next: ModuleConfig) {
  const nextStatuses = new Set(allStatuses(next).map((s) => s.key));
  const nextTypes = new Set(next.workItemTypes.map((w) => w.key));
  const before = allStatuses(detail.config);
  return {
    statuses: Object.entries(detail.usage.statuses)
      .filter(([key, n]) => n > 0 && !nextStatuses.has(key))
      .map(([key, n]) => ({ key, count: n, status: before.find((s) => s.key === key) })),
    types: Object.entries(detail.usage.types)
      .filter(([key, n]) => n > 0 && !nextTypes.has(key))
      .map(([key, n]) => ({
        key,
        count: n,
        label:
          detail.config.workItemTypes.find((w) => w.key === key)?.label ?? t('task.formerType'),
      })),
  };
}

function needsMapping(detail: DepartmentConfigDetail, next: ModuleConfig) {
  const g = gone(detail, next);
  return g.statuses.length > 0 || g.types.length > 0;
}

function MappingDialog({
  detail,
  next,
  pending,
  onCancel,
  onConfirm,
}: {
  detail: DepartmentConfigDetail;
  next: ModuleConfig;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (mappings: ConfigMappings) => void;
}) {
  const g = gone(detail, next);
  const nextStatuses = allStatuses(next);
  // A status moves only within its category (completion, XP and reports stay as they are).
  const targetsFor = (category: StatusCategory | undefined) =>
    nextStatuses.filter((s) => s.category === category);
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      g.statuses.map((s) => [s.key, targetsFor(s.status?.category)[0]?.key ?? '']),
    ),
  );
  const [types, setTypes] = useState<Record<string, string>>(() =>
    Object.fromEntries(g.types.map((w) => [w.key, next.workItemTypes[0]?.key ?? ''])),
  );
  const complete = g.statuses.every((s) => statuses[s.key]) && g.types.every((w) => types[w.key]);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t('departmentConfig.mapping.title')}
      description={t('departmentConfig.mapping.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('departments.cancel')}
          </Button>
          <Button
            loading={pending}
            disabled={!complete}
            onClick={() => onConfirm({ statuses, types })}
          >
            {t('departmentConfig.mapping.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {g.statuses.map((s) => {
          const targets = targetsFor(s.status?.category);
          return targets.length === 0 ? (
            <p
              key={s.key}
              className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink"
            >
              {t('departmentConfig.mapping.status', {
                name: s.status?.label ?? t('task.formerStatus'),
                count: formatNumber(s.count),
              })}{' '}
              {t('departmentConfig.mapping.noTarget')}
            </p>
          ) : (
            <SelectField
              key={s.key}
              label={t('departmentConfig.mapping.status', {
                name: s.status?.label ?? t('task.formerStatus'),
                count: formatNumber(s.count),
              })}
              value={statuses[s.key] ?? ''}
              onChange={(e) => setStatuses((m) => ({ ...m, [s.key]: e.target.value }))}
              options={targets.map((target) => ({ value: target.key, label: target.label }))}
            />
          );
        })}
        {g.types.map((w) => (
          <SelectField
            key={w.key}
            label={t('departmentConfig.mapping.type', {
              name: w.label,
              count: formatNumber(w.count),
            })}
            value={types[w.key] ?? ''}
            onChange={(e) => setTypes((m) => ({ ...m, [w.key]: e.target.value }))}
            options={next.workItemTypes.map((target) => ({
              value: target.key,
              label: target.label,
            }))}
          />
        ))}
      </div>
    </Modal>
  );
}

function ApplyTemplate({
  current,
  pending,
  onApply,
}: {
  current: string | null;
  pending: boolean;
  onApply: (key: TemplateKey, config: ModuleConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<TemplateKey>('general');
  const { data: templates } = useTemplates();
  const currentName = templates?.find((tpl) => tpl.key === current)?.name;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('departmentConfig.template')}</CardTitle>
        <CardDescription>
          {currentName
            ? t('departmentConfig.templateNow', { name: currentName })
            : t('departmentConfig.templateNone')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Modal
          open={open}
          onOpenChange={setOpen}
          title={t('departmentConfig.applyTitle')}
          description={t('departmentConfig.applyBody')}
          trigger={<Button variant="secondary">{t('departmentConfig.applyTemplate')}</Button>}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('departments.cancel')}
              </Button>
              <Button
                loading={pending}
                disabled={!templates}
                onClick={() => {
                  const template = templates?.find((tpl) => tpl.key === choice);
                  if (!template) return;
                  setOpen(false);
                  onApply(choice, template.config);
                }}
              >
                {t('departmentConfig.applyConfirm')}
              </Button>
            </>
          }
        >
          <TemplatePicker value={choice} onChange={setChoice} />
        </Modal>
      </CardContent>
    </Card>
  );
}
