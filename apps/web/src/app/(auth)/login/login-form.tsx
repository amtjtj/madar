'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { Button, TextField } from '@madar/ui';

import { AuthHeading } from '@/components/forms/auth-heading';
import { FormError } from '@/components/forms/form-error';
import { PasswordField } from '@/components/forms/password-field';
import { nextStep, useRefreshMe } from '@/hooks/use-me';
import { auth, safeNext } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const refreshMe = useRefreshMe();
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await auth.signIn(username, password);
      if (result?.twoFactorRedirect) {
        router.push(`/login/2fa?next=${encodeURIComponent(next)}`);
        return;
      }
      const me = await refreshMe();
      router.replace(nextStep(me) ?? next);
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return (
    <>
      <AuthHeading title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} />
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label={t('auth.login.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <PasswordField
          label={t('auth.login.password')}
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!username || !password}
        >
          {t('auth.login.submit')}
        </Button>
      </form>
      <p className="text-center text-sm text-ink-muted">
        {t('auth.login.noAccount')}{' '}
        <Link href="/signup" className="font-bold text-primary-ink hover:underline">
          {t('auth.login.signupLink')}
        </Link>
      </p>
    </>
  );
}
