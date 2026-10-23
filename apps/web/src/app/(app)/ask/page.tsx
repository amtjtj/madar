'use client';

import { MessageCircleQuestion, RotateCcw, SearchX, ShieldCheck, Sparkles } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { ASK_HISTORY_MAX, type AskResponse, type AskTurn } from '@madar/shared';
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

interface Turn {
  key: number;
  question: string;
  result?: AskResponse;
  problem?: string;
}

const EXAMPLES = ['decision', 'project', 'meeting'] as const;
/** An answer is sent back as context at most this long (the API's limit). */
const ANSWER_CONTEXT_MAX = 1500;

/**
 * «از مدار بپرس» (plan phase-3-step-16b, 16c; ADR 0026): questions in Persian, answered from the
 * company's knowledge the person may see, with numbered sources. A follow-up takes the last
 * answered turns of this page as context; nothing of the conversation is stored on the server.
 */
export default function AskPage() {
  const { data: status, isPending } = useAiStatus();
  const ask = useAsk();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const on = Boolean(status?.available && status.enabled);
  const thinking = ask.isPending;

  const submit = (text: string, event?: FormEvent) => {
    event?.preventDefault();
    const asked = text.trim();
    if (asked.length < 3 || thinking) return;
    const history: AskTurn[] = turns
      .filter((turn) => turn.result?.answer)
      .slice(-ASK_HISTORY_MAX)
      .map((turn) => ({
        question: turn.question,
        answer: (turn.result?.answer ?? '').slice(0, ANSWER_CONTEXT_MAX),
      }));
    const key = ++counter.current;
    const controller = new AbortController();
    abort.current = controller;
    ask.mutate(
      { question: asked, history, signal: controller.signal },
      {
        onSuccess: (result) => {
          setTurns((list) => [...list, { key, question: asked, result }]);
          setQuestion('');
        },
        onError: (error) => {
          if (error instanceof ApiClientError && error.code === 'aborted') return;
          setTurns((list) => [...list, { key, question: asked, problem: errorMessage(error) }]);
        },
      },
    );
  };

  const form = (
    <Card className="p-4">
      <form onSubmit={(e) => submit(question, e)} className="flex flex-col gap-3">
        <TextAreaField
          label={turns.length > 0 ? t('ask.followUp') : t('ask.question')}
          placeholder={turns.length > 0 ? t('ask.followUpPlaceholder') : t('ask.placeholder')}
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
            disabled={question.trim().length < 3 || thinking}
          >
            {t('ask.submit')}
          </Button>
          {thinking && (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              {t('ask.cancel')}
            </Button>
          )}
          {turns.length > 0 && !thinking && (
            <Button
              variant="ghost"
              icon={<RotateCcw aria-hidden />}
              onClick={() => {
                setTurns([]);
                setQuestion('');
              }}
            >
              {t('ask.newConversation')}
            </Button>
          )}
        </div>
        <p className="flex items-start gap-2 text-xs text-ink-subtle [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
          <ShieldCheck aria-hidden />
          {t('ask.privacy')}
        </p>
      </form>
    </Card>
  );

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
          {turns.length > 0 && (
            <ol
              aria-label={t('ask.conversation')}
              className="flex flex-col gap-6"
              aria-live="polite"
            >
              {turns.map((turn) => (
                <li key={turn.key} className="flex flex-col gap-3">
                  <p className="self-start rounded-2xl bg-primary-soft px-4 py-2 text-sm font-semibold text-primary-ink">
                    {turn.question}
                  </p>
                  {turn.problem ? (
                    <p
                      role="alert"
                      className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink"
                    >
                      {turn.problem}
                    </p>
                  ) : turn.result?.answer === null ? (
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
                  ) : turn.result ? (
                    <AnswerCard text={turn.result.answer ?? ''} idPrefix={`ask-${turn.key}-source`}>
                      {turn.result.sources.length > 0 && (
                        <SourceList
                          idPrefix={`ask-${turn.key}-source`}
                          Link={NextLink}
                          items={turn.result.sources.map((source) => ({
                            n: source.n,
                            kind: source.kind,
                            title: sourceTitle(source),
                            href: sourceHref(source),
                            cited: source.cited,
                          }))}
                        />
                      )}
                    </AnswerCard>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          {thinking && <AssistantThinking lines={3} />}

          {form}

          {turns.length === 0 && !thinking && (
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
        </div>
      )}
    </>
  );
}
