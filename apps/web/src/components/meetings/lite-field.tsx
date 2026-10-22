'use client';

import { Bold, List } from 'lucide-react';
import { useRef } from 'react';

import { t } from '@madar/i18n';
import { TextAreaField } from '@madar/ui';

import { applyMark } from '@/lib/letters';

/** A lite-text box (ADR 0020) with the bold and list buttons of the letter composer. */
export function LiteField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 6,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  maxLength: number;
  rows?: number;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mark = (kind: 'bold' | 'list') => {
    const el = textarea.current;
    const next = applyMark(
      value,
      el?.selectionStart ?? value.length,
      el?.selectionEnd ?? value.length,
      kind,
    );
    onChange(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.start, next.end);
    });
  };
  const tool =
    'grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-4';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => mark('bold')}
            aria-label={t('letters.compose.bold')}
            title={t('letters.compose.bold')}
            className={tool}
          >
            <Bold aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => mark('list')}
            aria-label={t('letters.compose.list')}
            title={t('letters.compose.list')}
            className={tool}
          >
            <List aria-hidden />
          </button>
        </div>
      </div>
      <TextAreaField
        ref={textarea}
        label={label}
        hideLabel
        hint={t('letters.compose.bodyHint')}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
