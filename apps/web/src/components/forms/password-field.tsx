'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { TextField, type TextFieldProps } from '@madar/ui';

/** Password input with a show/hide toggle. Left-to-right so Latin passwords read naturally. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      dir="ltr"
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
          aria-pressed={visible}
          className="grid size-9 place-items-center rounded-md text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-5"
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
      }
    />
  );
}
