'use client';

import { Pencil, Reply, Send, X } from 'lucide-react';
import { useState, type KeyboardEvent, type RefObject } from 'react';

import { t } from '@madar/i18n';
import { MESSAGE_FILES_MAX, MESSAGE_MAX, type Message, type Upload } from '@madar/shared';
import { Button, FileTile, MentionSuggestions, cn, type MentionRef } from '@madar/ui';

import { FilePicker, PendingList } from '@/components/work/attachments';
import { useUploads } from '@/hooks/files';
import { decodeMentions, encodeMentions, matchPeople, mentionQuery } from '@/lib/chat';

/**
 * Writing a message (plan phase-2-step-15b): text with «@» mentions picked from the
 * conversation's people, files from the picker, a drop or a pasted image. Enter sends,
 * Shift+Enter starts a new line.
 */
export function Composer({
  id,
  people,
  replyTo,
  editing,
  onCancel,
  onSend,
  onEdit,
  inputRef,
}: {
  id: string;
  /** Who can be mentioned (everyone reading the conversation, without me). */
  people: MentionRef[];
  replyTo: Message | null;
  editing: Message | null;
  onCancel: () => void;
  /** Rejects when sending failed: the text and files come back to the box. */
  onSend: (body: string, uploads: Upload[], mentions: MentionRef[]) => Promise<unknown>;
  onEdit: (message: Message, body: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<MentionRef[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const files = useUploads();
  const listId = `mentions-${id}`;

  // Editing a message puts its text (mentions as «@name») in the box; set during render.
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    if (editing) {
      setText(decodeMentions(editing.body, editing.mentions));
      setPicked(editing.mentions);
    }
  }

  const matches = query ? matchPeople(people, query.query) : [];
  const uploading = files.pending.length > 0;
  const canSend = !uploading && (text.trim().length > 0 || (!editing && uploads.length > 0));

  const add = async (picked: File[]) => {
    // Uploads still running count too, so two quick picks cannot pass the limit.
    const room = MESSAGE_FILES_MAX - uploads.length - files.pending.length;
    const done = await files.upload(picked.slice(0, Math.max(room, 0)));
    setUploads((list) => [...list, ...done].slice(0, MESSAGE_FILES_MAX));
  };

  const reset = () => {
    setText('');
    setPicked([]);
    setUploads([]);
    setQuery(null);
  };

  const submit = () => {
    if (!canSend) return;
    const body = encodeMentions(text.trim(), picked);
    if (editing) {
      onEdit(editing, body);
    } else {
      const kept = { text, picked, uploads };
      onSend(body, uploads, picked).catch(() => {
        // Nothing is lost on a failed send: put it back, unless something new was typed.
        setText((now) => now || kept.text);
        setPicked((now) => (now.length ? now : kept.picked));
        setUploads((now) => (now.length ? now : kept.uploads));
      });
    }
    reset();
    inputRef.current?.focus();
  };

  const pick = (person: MentionRef) => {
    if (!query) return;
    const caret = query.start + 1 + query.query.length;
    const next = `${text.slice(0, query.start)}@${person.displayName} ${text.slice(caret)}`;
    setText(next);
    setPicked((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]));
    setQuery(null);
    const at = query.start + person.displayName.length + 2;
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const person = matches[Math.min(active, matches.length - 1)];
        if (person) pick(person);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (query) setQuery(null);
      else onCancel();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      aria-label={t('chat.composer')}
      className={cn(
        'relative flex flex-col gap-2 border-t border-line pt-3',
        dragging && 'rounded-xl outline-2 outline-dashed outline-primary',
      )}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => {
        if (editing || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (editing || !e.dataTransfer.files.length) return;
        e.preventDefault();
        void add([...e.dataTransfer.files]);
      }}
    >
      {query && (
        <MentionSuggestions
          id={listId}
          people={matches}
          activeIndex={Math.min(active, Math.max(matches.length - 1, 0))}
          onPick={pick}
          className="absolute inset-x-0 bottom-full mb-2"
        />
      )}
      {(replyTo || editing) && (
        <div className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-xs text-ink-muted">
          {replyTo ? (
            <Reply aria-hidden className="size-3.5" />
          ) : (
            <Pencil aria-hidden className="size-3.5" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {replyTo
              ? `${t('chat.replyingTo', { name: replyTo.author.displayName })}: ${decodeMentions(replyTo.body, replyTo.mentions)}`
              : t('chat.editing')}
          </span>
          <button
            type="button"
            aria-label={replyTo ? t('chat.cancelReply') : t('chat.cancelEdit')}
            onClick={() => {
              if (editing) reset();
              onCancel();
            }}
            className="grid size-7 place-items-center rounded-full hover:bg-surface [&_svg]:size-3.5"
          >
            <X aria-hidden />
          </button>
        </div>
      )}
      {uploads.length > 0 && (
        <ul aria-label={t('chat.attached')} className="flex flex-col gap-1.5">
          {uploads.map((u) => (
            <li key={u.id}>
              <FileTile
                fileName={u.fileName}
                size={u.size}
                kind={u.kind}
                className="p-1.5"
                actions={
                  <button
                    type="button"
                    aria-label={t('work.files.delete', { name: u.fileName })}
                    onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                    className="grid size-9 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
                  >
                    <X aria-hidden />
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <PendingList pending={files.pending} onCancel={files.cancel} />
      <div className="flex items-end gap-1">
        {!editing && (
          <FilePicker
            label={t('chat.attach')}
            iconOnly
            disabled={uploads.length >= MESSAGE_FILES_MAX}
            onFiles={(picked) => void add(picked)}
          />
        )}
        <label htmlFor={`composer-${id}`} className="sr-only">
          {t('chat.placeholder')}
        </label>
        <textarea
          id={`composer-${id}`}
          ref={inputRef}
          rows={1}
          maxLength={MESSAGE_MAX}
          value={text}
          role={query ? 'combobox' : undefined}
          aria-autocomplete={query ? 'list' : undefined}
          aria-expanded={query ? matches.length > 0 : undefined}
          aria-controls={query && matches.length ? listId : undefined}
          aria-activedescendant={
            query && matches[active] ? `${listId}-${matches[active]?.id}` : undefined
          }
          onChange={(e) => {
            setText(e.target.value);
            const found = mentionQuery(e.target.value, e.target.selectionStart);
            setQuery(found);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setQuery(null)}
          onPaste={(e) => {
            if (editing) return;
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              void add(pasted);
            }
          }}
          placeholder={t('chat.placeholder')}
          className="ms-1 max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-focus [field-sizing:content]"
        />
        <Button
          type="submit"
          size="icon"
          className="ms-1"
          aria-label={t('chat.send')}
          disabled={!canSend}
          icon={<Send aria-hidden className="rtl:-scale-x-100" />}
        />
      </div>
    </form>
  );
}
