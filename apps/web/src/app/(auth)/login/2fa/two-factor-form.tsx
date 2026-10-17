'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { toLatinDigits } from '@madar/shared';
import { Button, TextField } from '@madar/ui';

import { AuthHeading } from '@/components/forms/auth-heading';
import { FormError } from '@/components/forms/form-error';
import { nextStep, useRefreshMe } from '@/hooks/use-me';
import { auth, safeNext } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const refreshMe = useRefreshMe();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'app' | 'backup'>('app');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const digits = toLatinDigits(code).replace(/\D/g, '');
  const ready = mode === 'app' ? digits.length === 6 : code.trim().length >= 6;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === 'app') await auth.verifyTotp(digits);
      else await auth.verifyBackupCode(code);
      const me = await refreshMe();
      router.replace(nextStep(me) ?? next);
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return (
    <>
      <AuthHeading
        title={t('auth.twoFactor.title')}
        subtitle={mode === 'app' ? t('auth.twoFactor.subtitle') : t('auth.twoFactor.backupHint')}
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        {mode === 'app' ? (
          <TextField
            key="app"
            label={t('auth.twoFactor.code')}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            autoFocus
            className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6))}
          />
        ) : (
          <TextField
            key="backup"
            label={t('auth.twoFactor.backupCode')}
            name="backupCode"
            autoComplete="off"
            dir="ltr"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
        <Button type="submit" size="lg" fullWidth loading={pending} disabled={!ready}>
          {t('auth.twoFactor.submit')}
        </Button>
      </form>
      <div className="flex flex-col items-center gap-2 text-sm">
        <button
          type="button"
          className="font-semibold text-primary-ink hover:underline"
          onClick={() => {
            setMode(mode === 'app' ? 'backup' : 'app');
            setCode('');
            setError(null);
          }}
        >
          {mode === 'app' ? t('auth.twoFactor.useBackup') : t('auth.twoFactor.useApp')}
        </button>
        <Link href="/login" className="text-ink-muted hover:text-ink">
          {t('auth.twoFactor.back')}
        </Link>
      </div>
    </>
  );
}
