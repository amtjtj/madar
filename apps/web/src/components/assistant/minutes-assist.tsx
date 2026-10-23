'use client';

import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber, MINUTES_NOTES_MAX, type MinutesDraftResponse } from '@madar/shared';
import { AssistantThinking, Button, CheckboxField, DraftCard, LiteText, useToast } from '@madar/ui';

import { useMinutesDraft } from '@/hooks/ai';
import { useAddDecision } from '@/hooks/meetings';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

import { AssistantGate } from './assistant-gate';

/**
 * «مرتب کن با دستیار» (plan phase-3-step-16c): the writer's notes become tidy minutes and suggested
 * decisions. Nothing is saved here: «جایگزین متن» only fills the editor, and decisions are added
 * one by one through the ordinary decision endpoint when the person ticks them.
 */
export function MinutesAssist(props: {
  meetingId: string;
  notes: string;
  onReplace: (text: string) => void;
}) {
  return (
    <AssistantGate>
      <MinutesAssistInner {...props} />
    </AssistantGate>
  );
}

function MinutesAssistInner({
  meetingId,
  notes,
  onReplace,
}: {
  meetingId: string;
  notes: string;
  onReplace: (text: string) => void;
}) {
  const draft = useMinutesDraft();
  const addDecision = useAddDecision(meetingId);
  const { toast } = useToast();
  const [result, setResult] = useState<MinutesDraftResponse | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [problem, setProblem] = useState('');
  const [adding, setAdding] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const ask = () => {
    const controller = new AbortController();
    abort.current = controller;
    setProblem('');
    setResult(null);
    draft.mutate(
      { meetingId, notes: notes.trim(), signal: controller.signal },
      {
        onSuccess: (next) => {
          setResult(next);
          setPicked(new Set(next.decisions.map((_, i) => i)));
        },
        onError: (error) => {
          if (error instanceof ApiClientError && error.code === 'aborted') return;
          setProblem(errorMessage(error));
        },
      },
    );
  };

  const add = async () => {
    if (!result) return;
    const chosen = result.decisions.filter((_, i) => picked.has(i));
    let left = result.decisions;
    setAdding(true);
    let done = 0;
    try {
      for (const text of chosen) {
        await addDecision.mutateAsync(text);
        done++;
        // Each one leaves the list as soon as it is added, so a retry never adds it twice.
        left = left.filter((d) => d !== text);
        const remaining = left;
        setResult((current) => (current ? { ...current, decisions: remaining } : current));
        setPicked(
          new Set(remaining.map((d, i) => (chosen.includes(d) ? i : -1)).filter((i) => i >= 0)),
        );
      }
      toast({
        tone: 'success',
        title: t('assistant.minutes.decisionsAdded', { count: formatNumber(done) }),
      });
    } catch (error) {
      toast({ tone: 'error', title: errorMessage(error) });
    } finally {
      setAdding(false);
    }
  };

  if (draft.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <AssistantThinking lines={2} />
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => abort.current?.abort()}
        >
          {t('assistant.cancel')}
        </Button>
      </div>
    );
  }

  if (result) {
    return (
      <DraftCard
        title={t('assistant.minutes.draftTitle')}
        actions={
          <>
            <Button
              size="sm"
              onClick={() => {
                onReplace(result.text);
                toast({ tone: 'success', title: t('assistant.minutes.replaced') });
              }}
            >
              {t('assistant.minutes.replace')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
              {t('assistant.minutes.discard')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <LiteText text={result.text} />
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-ink-muted">{t('assistant.minutes.decisions')}</h3>
            {result.decisions.length === 0 ? (
              <p className="text-sm text-ink-subtle">{t('assistant.minutes.noDecisions')}</p>
            ) : (
              <>
                {result.decisions.map((decision, i) => (
                  <CheckboxField
                    key={decision}
                    label={decision}
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setPicked(next);
                    }}
                  />
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  loading={adding}
                  disabled={picked.size === 0}
                  onClick={() => void add()}
                >
                  {t('assistant.minutes.addDecisions', { count: formatNumber(picked.size) })}
                </Button>
              </>
            )}
          </div>
        </div>
      </DraftCard>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        icon={<Sparkles aria-hidden />}
        disabled={notes.trim().length < 3 || notes.trim().length > MINUTES_NOTES_MAX}
        onClick={ask}
      >
        {t('assistant.minutes.tidy')}
      </Button>
      {notes.trim().length < 3 && (
        <p className="text-xs text-ink-subtle">{t('assistant.minutes.tidyHint')}</p>
      )}
      {notes.trim().length > MINUTES_NOTES_MAX && (
        <p className="text-xs text-ink-subtle">
          {t('assistant.minutes.tooLong', { max: formatNumber(MINUTES_NOTES_MAX) })}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">
          {problem}
        </p>
      )}
    </div>
  );
}
