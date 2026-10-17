'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { passwordSchema } from '@madar/shared';
import { Button } from '@madar/ui';

import { AuthHeading } from '@/components/forms/auth-heading';
import { FormError } from '@/components/forms/form-error';
import { PasswordField } from '@/components/forms/password-field';
import { nextStep, useRefreshMe } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function ChangePasswordPage() {
  const router = useRouter();
  const refreshMe = useRefreshMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<{ next?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: typeof fieldError = {};
    if (!passwordSchema.safeParse(next).success) errors.next = t('errors.passwordTooShort');
    if (next !== confirm) errors.confirm = t('errors.passwordMismatch');
    setFieldError(errors);
    if (Object.keys(errors).length) return;

    setPending(true);
    try {
      await api('/api/me/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      const me = await refreshMe();
      router.replace(nextStep(me) ?? '/');
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return (
    <>
      <AuthHeading
        title={t('auth.changePassword.title')}
        subtitle={t('auth.changePassword.subtitle')}
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <PasswordField
          label={t('auth.changePassword.current')}
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <PasswordField
          label={t('auth.changePassword.next')}
          hint={t('auth.signup.passwordHint')}
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={fieldError.next}
        />
        <PasswordField
          label={t('auth.changePassword.confirm')}
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldError.confirm}
        />
        <Button type="submit" size="lg" fullWidth loading={pending} disabled={!current || !next}>
          {t('auth.changePassword.submit')}
        </Button>
      </form>
    </>
  );
}
