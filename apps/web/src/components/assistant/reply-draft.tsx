'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import type { Letter } from '@madar/shared';
import { AssistantThinking, Button, Modal, TextField } from '@madar/ui';

import { useLetterReplyDraft } from '@/hooks/ai';
import { ApiClientError } from '@/lib/api';
import { keepReplyDraft } from '@/lib/assistant-drafts';
import { errorMessage } from '@/lib/errors';

import { AssistantGate } from './assistant-gate';

/**
 * «پیش‌نویس پاسخ با دستیار» (plan phase-3-step-16c): one line of intent becomes a polite reply that
 * opens in the ordinary composer; the person edits it and sends it. Never for a confidential letter.
 */
export function ReplyDraft({ letter }: { letter: Letter }) {
  if (!letter.can.reply || letter.confidential) return null;
  return (
    <AssistantGate>
      <ReplyDraftDialog letter={letter} />
    </AssistantGate>
  );
}

function ReplyDraftDialog({ letter }: { letter: Letter }) {
  const router = useRouter();
  const draft = useLetterReplyDraft();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [problem, setProblem] = useState('');
  const abort = useRef<AbortController | null>(null);

  const write = (event?: FormEvent) => {
    event?.preventDefault();
    const controller = new AbortController();
    abort.current = controller;
    setProblem('');
    draft.mutate(
      { letterId: letter.id, intent: intent.trim(), signal: controller.signal },
      {
        onSuccess: ({ text }) => {
          keepReplyDraft(letter.id, text);
          router.push(`/letters/new?replyTo=${letter.id}`);
        },
        onError: (error) => {
          if (error instanceof ApiClientError && error.code === 'aborted') return;
          setProblem(errorMessage(error));
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) abort.current?.abort();
      }}
      title={t('assistant.reply.title')}
      description={t('assistant.privacy')}
      trigger={
        <Button variant="secondary" icon={<Sparkles aria-hidden />}>
          <span className="max-md:sr-only">{t('assistant.reply.open')}</span>
        </Button>
      }
    >
      {draft.isPending ? (
        <div className="flex flex-col gap-3">
          <AssistantThinking lines={3} />
          <Button variant="ghost" className="self-start" onClick={() => abort.current?.abort()}>
            {t('assistant.cancel')}
          </Button>
        </div>
      ) : (
        <form onSubmit={write} className="flex flex-col gap-4">
          <TextField
            label={t('assistant.reply.intent')}
            hint={t('assistant.reply.intentHint')}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            maxLength={300}
            autoFocus
          />
          {problem && (
            <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">
              {problem}
            </p>
          )}
          <Button type="submit" icon={<Sparkles aria-hidden />}>
            {problem ? t('assistant.retry') : t('assistant.reply.write')}
          </Button>
        </form>
      )}
    </Modal>
  );
}
