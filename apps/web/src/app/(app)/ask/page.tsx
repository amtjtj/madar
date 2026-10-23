'use client';

import { MessageCircleQuestion, SearchX, ShieldCheck, Sparkles } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import type { AskResponse } from '@madar/shared';
import {
  AnswerCard,
  AssistantThinking,
  Button,
  Card,
  EmptyState,
  Skeleton,
  SourceList,
  TextAreaField,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { NextLink } from '@/components/next-link';
import { useAiStatus, useAsk } from '@/hooks/ai';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { sourceHref, sourceTitle } from '@/lib/knowledge';

type Stage =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'answered'; question: string; result: AskResponse }
  | { kind: 'failed'; message: string };

const EXAMPLES = ['decision', 'project', 'meeting'] as const;

/**
 * «از مدار بپرس» (plan phase-3-step-16b, ADR 0026): a question in Persian, answered from the
 * company's knowledge the person may see, with numbered sources that open their pages.
 */
export default function AskPage() {
  const { data: status, isPending } = useAiStatus();
  const ask = useAsk();
  const [question, setQuestion] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const on = Boolean(status?.available && status.enabled);

  const submit = (text: string, event?: FormEvent) => {
    event?.preventDefault();
    const asked = text.trim();
    if (asked.length < 3 || stage.kind === 'thinking') return;
    const controller = new AbortController();
    abort.current = controller;
    setStage({ kind: 'thinking' });
    ask.mutate(
      { question: asked, signal: controller.signal },
      {
        onSuccess: (result) => setStage({ kind: 'answered', question: asked, result }),
        onError: (error) =>
          setStage(
            error instanceof ApiClientError && error.code === 'aborted'
              ? { kind: 'idle' }
              : { kind: 'failed', message: errorMessage(error) },
          ),
      },
    );
  };

  return (
    <>
      <PageHeader title={t('ask.title')} subtitle={t('ask.subtitle')} />
      {isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !on ? (
        <Card>
          <EmptyState title={t('ask.off')} description={t('ask.offHint')} />
        </Card>
      ) : (
        <div className="flex max-w-3xl flex-col gap-6 pb-20 md:pb-0">
          <Card className="p-4">
            <form onSubmit={(e) => submit(question, e)} className="flex flex-col gap-3">
              <TextAreaField
                label={t('ask.question')}
                placeholder={t('ask.placeholder')}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  // Enter asks; Shift+Enter starts a new line.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit(question);
                  }
                }}
                maxLength={500}
                rows={2}
                required
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  icon={<Sparkles aria-hidden />}
                  disabled={question.trim().length < 3 || stage.kind === 'thinking'}
                >
                  {t('ask.submit')}
                </Button>
                {stage.kind === 'thinking' && (
                  <Button variant="ghost" onClick={() => abort.current?.abort()}>
                    {t('ask.cancel')}
                  </Button>
                )}
              </div>
              <p className="flex items-start gap-2 text-xs text-ink-subtle [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
                <ShieldCheck aria-hidden />
                {t('ask.privacy')}
              </p>
            </form>
          </Card>

          {stage.kind === 'idle' && (
            <section aria-labelledby="ask-examples" className="flex flex-col gap-2">
              <h2 id="ask-examples" className="text-sm font-bold text-ink-muted">
                {t('ask.examplesTitle')}
              </h2>
              <ul className="flex flex-col gap-2">
                {EXAMPLES.map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-start text-sm text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-accent-ink"
                      onClick={() => {
                        const text = t(`ask.examples.${key}`);
                        setQuestion(text);
                        submit(text);
                      }}
                    >
                      <MessageCircleQuestion aria-hidden />
                      {t(`ask.examples.${key}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stage.kind === 'thinking' && <AssistantThinking lines={3} />}

          {stage.kind === 'failed' && (
            <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">
              {stage.message}
            </p>
          )}

          {stage.kind === 'answered' && (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p className="text-sm text-ink-muted">
                {t('ask.asked', { question: stage.question })}
              </p>
              {stage.result.answer === null ? (
                <Card>
                  <EmptyState
                    illustration={
                      <span className="grid size-14 place-items-center rounded-2xl bg-sunken text-ink-subtle [&_svg]:size-7">
                        <SearchX aria-hidden />
                      </span>
                    }
                    title={t('ask.notFoundTitle')}
                    description={t('ask.notFoundText')}
                  />
                </Card>
              ) : (
                <AnswerCard text={stage.result.answer} idPrefix="ask-source">
                  {stage.result.sources.length > 0 && (
                    <SourceList
                      idPrefix="ask-source"
                      Link={NextLink}
                      items={stage.result.sources.map((source) => ({
                        n: source.n,
                        kind: source.kind,
                        title: sourceTitle(source),
                        href: sourceHref(source),
                        cited: source.cited,
                      }))}
                    />
                  )}
                </AnswerCard>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
