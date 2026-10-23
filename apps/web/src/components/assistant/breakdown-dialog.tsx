'use client';

import { Sparkles } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import {
  AssistantThinking,
  Button,
  Modal,
  SelectField,
  SuggestionList,
  TextField,
  useToast,
  type Suggestion,
} from '@madar/ui';

import { useCreateSuggested, useTaskBreakdown } from '@/hooks/ai';
import { useDepartments, useMembers } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

type Stage = 'ask' | 'thinking' | 'review';

let counter = 0;
const newKey = () => `s${++counter}`;

/**
 * «پیشنهاد دستیار» (plan phase-3-step-16a): one sentence becomes suggested tasks that the person
 * edits, assigns and confirms; nothing is made until «ساختن». Only shown when the assistant is on.
 */
export function BreakdownDialog({ today }: { today: string }) {
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const { data: members } = useMembers();
  const breakdown = useTaskBreakdown();
  const create = useCreateSuggested();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('ask');
  const [sentence, setSentence] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const abort = useRef<AbortController | null>(null);

  const member = me?.member;
  // Departments where I may add work: my own, or all for company-wide task managers.
  const mine = new Set(member?.departments.map((d) => d.id));
  const choices = (departments ?? []).filter(
    (d) => member?.permissions['task.manage'] === 'tenant' || mine.has(d.id),
  );
  const chosen = departmentId || choices[0]?.id || '';
  const people = (members ?? []).filter((m) => m.status === 'active');

  const reset = () => {
    abort.current?.abort();
    setStage('ask');
    setItems([]);
    setAssignees({});
    setProblem('');
  };

  const ask = (event?: FormEvent) => {
    event?.preventDefault();
    if (sentence.trim().length < 3 || !chosen) return;
    const controller = new AbortController();
    abort.current = controller;
    setProblem('');
    setStage('thinking');
    breakdown.mutate(
      { sentence: sentence.trim(), departmentId: chosen, signal: controller.signal },
      {
        onSuccess: (result) => {
          const next = result.tasks.map((task) => ({ key: newKey(), ...task }));
          setItems(next);
          setAssignees(Object.fromEntries(next.map((i) => [i.key, member?.id ?? ''])));
          setStage('review');
        },
        onError: (error) => {
          setStage('ask');
          if (error instanceof ApiClientError && error.code === 'aborted') return;
          setProblem(errorMessage(error));
        },
      },
    );
  };

  const valid = items.filter((i) => i.title.trim());
  const save = () => {
    create.mutate(
      valid.map((i) => ({
        title: i.title.trim(),
        dueOn: i.dueOn,
        departmentId: chosen,
        assigneeId: assignees[i.key] || null,
      })),
      {
        onSuccess: (count) => {
          toast({ tone: 'success', title: t('assistant.created', { count: formatNumber(count) }) });
          setOpen(false);
          setSentence('');
          reset();
        },
        onError: (error) =>
          toast({
            tone: 'error',
            title: t('assistant.createFailed', {
              done: formatNumber((error as { done?: number }).done ?? 0),
              reason: errorMessage(error),
            }),
          }),
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title={t('assistant.suggestTitle')}
      description={t('assistant.privacy')}
      trigger={
        <Button variant="secondary" icon={<Sparkles aria-hidden />}>
          {t('assistant.suggest')}
        </Button>
      }
    >
      {stage === 'ask' && (
        <form onSubmit={ask} className="flex flex-col gap-4">
          <TextField
            label={t('assistant.sentence')}
            hint={t('assistant.sentenceHint')}
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            maxLength={300}
            required
            autoFocus
          />
          {choices.length > 1 && (
            <SelectField
              label={t('assistant.department')}
              value={chosen}
              onChange={(e) => setDepartmentId(e.target.value)}
              options={choices.map((d) => ({ value: d.id, label: d.name }))}
            />
          )}
          {problem && (
            <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">
              {problem}
            </p>
          )}
          <Button
            type="submit"
            icon={<Sparkles aria-hidden />}
            disabled={sentence.trim().length < 3}
          >
            {problem ? t('assistant.retry') : t('assistant.ask')}
          </Button>
        </form>
      )}
      {stage === 'thinking' && (
        <AssistantThinking
          lines={4}
          action={
            <Button variant="ghost" className="self-start" onClick={() => abort.current?.abort()}>
              {t('assistant.cancel')}
            </Button>
          }
        />
      )}
      {stage === 'review' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            {t('assistant.quoted', { text: sentence.trim() })}
          </p>
          {items.length ? (
            <SuggestionList
              label={t('assistant.suggestions')}
              items={items}
              onChange={setItems}
              today={today}
              newKey={newKey}
              extra={(item, n) => (
                <SelectField
                  label={t('assistant.assigneeOf', { n })}
                  value={assignees[item.key] ?? ''}
                  onChange={(e) => setAssignees({ ...assignees, [item.key]: e.target.value })}
                  options={[
                    { value: '', label: t('assistant.noAssignee') },
                    ...people.map((p) => ({ value: p.id, label: p.displayName })),
                  ]}
                />
              )}
            />
          ) : (
            <p className="text-sm text-ink-subtle">{t('assistant.emptyList')}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              className="flex-1"
              loading={create.isPending}
              disabled={valid.length === 0}
              onClick={save}
            >
              {t('assistant.create', { count: formatNumber(valid.length) })}
            </Button>
            <Button variant="ghost" onClick={() => ask()}>
              {t('assistant.again')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
