'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import {
  keyResultRange,
  PARENT_LEVELS,
  parseDecimal,
  formatNumber,
  type GoalLevel,
  type KeyResultKind,
} from '@madar/shared';
import { Button, Modal, SelectField, TextField, useToast } from '@madar/ui';

import { useCreateGoal, useGoals } from '@/hooks/goals';
import { useDepartments } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';

interface KrDraft {
  key: number;
  title: string;
  kind: KeyResultKind;
  start: string;
  target: string;
  unit: string;
}

const parseNumber = parseDecimal;

let nextKey = 1;
const emptyKr = (): KrDraft => ({
  key: nextKey++,
  title: '',
  kind: 'number',
  start: '',
  target: '',
  unit: '',
});

/** «New goal»: title, level, alignment and a few key results, quick enough for a phone. */
export function NewGoalButton({
  periodId,
  defaultLevel,
}: {
  periodId: string;
  defaultLevel: GoalLevel;
}) {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const { data: periodGoals } = useGoals('company', periodId);
  const create = useCreateGoal();
  const { toast } = useToast();

  const member = me?.member;
  const managesCompany = member?.permissions['goal.manage'] === 'tenant';
  const myDepartments = member?.departments ?? [];
  const managed = myDepartments.filter((d) => d.deptRole === 'head' || d.deptRole === 'manager');
  const levels: GoalLevel[] = [
    ...(managesCompany ? (['company'] as const) : []),
    ...(managesCompany || managed.length ? (['department'] as const) : []),
    ...(myDepartments.length ? (['individual'] as const) : []),
  ];

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<GoalLevel>(defaultLevel);
  const [departmentId, setDepartmentId] = useState('');
  const [parentId, setParentId] = useState('');
  const [krs, setKrs] = useState<KrDraft[]>([emptyKr()]);

  const departmentChoices = (departments ?? []).filter((d) =>
    level === 'department'
      ? managesCompany || managed.some((m) => m.id === d.id)
      : myDepartments.some((m) => m.id === d.id),
  );
  const parentChoices = (periodGoals ?? []).filter((g) => PARENT_LEVELS[level].includes(g.level));

  const onOpenChange = (next: boolean) => {
    if (next) {
      const initial = levels.includes(defaultLevel)
        ? defaultLevel
        : (levels.at(-1) ?? 'individual');
      setTitle('');
      setLevel(initial);
      setDepartmentId((initial === 'department' ? managed[0]?.id : myDepartments[0]?.id) ?? '');
      setParentId('');
      setKrs([emptyKr()]);
    }
    setOpen(next);
  };

  const changeLevel = (next: GoalLevel) => {
    setLevel(next);
    setParentId('');
    if (next === 'department' && !managed.some((m) => m.id === departmentId) && !managesCompany) {
      setDepartmentId(managed[0]?.id ?? '');
    }
  };

  const updateKr = (key: number, patch: Partial<KrDraft>) =>
    setKrs((list) => list.map((kr) => (kr.key === key ? { ...kr, ...patch } : kr)));

  const filled = krs.filter((kr) => kr.title.trim());
  const keyResults = filled.map((kr) => ({
    title: kr.title.trim(),
    kind: kr.kind,
    ...(kr.kind === 'number'
      ? {
          startValue: parseNumber(kr.start) ?? 0,
          targetValue: parseNumber(kr.target),
          unit: kr.unit.trim() || null,
        }
      : {}),
  }));
  const rangesValid = keyResults.every((kr) => keyResultRange(kr) !== null);
  // Only complain once a target was typed (an empty one is just not filled in yet).
  const rangeError = keyResults.some(
    (kr, i) => filled[i]?.target.trim() && keyResultRange(kr) === null,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!rangesValid) return;
    create.mutate(
      {
        periodId,
        level,
        ...(level !== 'company' && departmentId ? { departmentId } : {}),
        parentId: parentId || null,
        title: title.trim(),
        keyResults,
      },
      {
        onSuccess: (goal) => {
          toast({ tone: 'success', title: t('goals.form.created') });
          setOpen(false);
          router.push(`/goals/${goal.id}`);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  if (levels.length === 0) return null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('goals.newTitle')}
      trigger={<Button icon={<Plus aria-hidden />}>{t('goals.new')}</Button>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('goals.form.title')}
          placeholder={t('goals.form.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={t('goals.form.level')}
            value={level}
            onChange={(e) => changeLevel(e.target.value as GoalLevel)}
            options={levels.map((l) => ({ value: l, label: t(`goals.levels.${l}`) }))}
          />
          {level !== 'company' && (
            <SelectField
              label={t('goals.form.department')}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              options={departmentChoices.map((d) => ({ value: d.id, label: d.name }))}
            />
          )}
        </div>
        {level !== 'company' && (
          <SelectField
            label={t('goals.form.parent')}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            options={[
              { value: '', label: t('goals.form.noParent') },
              ...parentChoices.map((g) => ({ value: g.id, label: g.title })),
            ]}
          />
        )}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-bold text-ink">{t('goals.form.keyResults')}</legend>
          <p className="-mt-1 text-sm text-ink-muted">{t('goals.form.keyResultsHint')}</p>
          {krs.map((kr, i) => {
            const index = formatNumber(i + 1);
            return (
              <div key={kr.key} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="flex items-end gap-2">
                  <TextField
                    className="flex-1"
                    label={t('goals.form.krTitle', { index })}
                    placeholder={t('goals.form.krTitlePlaceholder')}
                    value={kr.title}
                    onChange={(e) => updateKr(kr.key, { title: e.target.value })}
                    maxLength={200}
                  />
                  {krs.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('goals.form.removeKeyResult', { index })}
                      onClick={() => setKrs((list) => list.filter((k) => k.key !== kr.key))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                <SelectField
                  label={t('goals.form.kind')}
                  value={kr.kind}
                  onChange={(e) => updateKr(kr.key, { kind: e.target.value as KeyResultKind })}
                  options={(['number', 'percent', 'boolean'] as const).map((k) => ({
                    value: k,
                    label: t(`goals.form.kinds.${k}`),
                  }))}
                />
                {kr.kind === 'number' && (
                  <div className="grid grid-cols-3 gap-2">
                    <TextField
                      label={t('goals.form.start')}
                      inputMode="decimal"
                      value={kr.start}
                      onChange={(e) => updateKr(kr.key, { start: e.target.value })}
                    />
                    <TextField
                      label={t('goals.form.target')}
                      inputMode="decimal"
                      value={kr.target}
                      onChange={(e) => updateKr(kr.key, { target: e.target.value })}
                      required={Boolean(kr.title.trim())}
                    />
                    <TextField
                      label={t('goals.form.unit')}
                      placeholder={t('goals.form.unitPlaceholder')}
                      value={kr.unit}
                      onChange={(e) => updateKr(kr.key, { unit: e.target.value })}
                      maxLength={20}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {krs.length < 10 && (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              icon={<Plus aria-hidden />}
              onClick={() => setKrs((list) => [...list, emptyKr()])}
            >
              {t('goals.form.addKeyResult')}
            </Button>
          )}
          {rangeError && (
            <p role="alert" className="text-sm text-danger-ink">
              {t('goals.form.invalidRange')}
            </p>
          )}
        </fieldset>
        <Button
          type="submit"
          loading={create.isPending}
          disabled={!title.trim() || (level !== 'company' && !departmentId) || !rangesValid}
        >
          {t('goals.form.create')}
        </Button>
      </form>
    </Modal>
  );
}
