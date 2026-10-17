'use client';

import { Check, Copy, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { toLatinDigits } from '@madar/shared';
import { Button, TextField } from '@madar/ui';

import { AuthHeading } from '@/components/forms/auth-heading';
import { FormError } from '@/components/forms/form-error';
import { PasswordField } from '@/components/forms/password-field';
import { nextStep, useRefreshMe } from '@/hooks/use-me';
import { auth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

interface Enrollment {
  qrSvg: string;
  secret: string;
  backupCodes: string[];
}

export default function SetupTwoFactorPage() {
  const router = useRouter();
  const refreshMe = useRefreshMe();
  const [password, setPassword] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await auth.enableTwoFactor(password);
      const qrSvg = await QRCode.toString(result.totpURI, { type: 'svg', margin: 1, width: 200 });
      const secret = new URL(result.totpURI).searchParams.get('secret') ?? '';
      setEnrollment({ qrSvg, secret, backupCodes: result.backupCodes });
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await auth.verifyTotp(code);
      const me = await refreshMe();
      router.replace(nextStep(me) ?? '/');
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  function downloadCodes() {
    if (!enrollment) return;
    const blob = new Blob(
      [
        `${t('app.name')} — ${t('auth.setupTwoFactor.backupTitle')}\n\n${enrollment.backupCodes.join('\n')}\n`,
      ],
      {
        type: 'text/plain;charset=utf-8',
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t('auth.setupTwoFactor.backupFileName');
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copySecret() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; the key stays visible to copy by hand
    }
  }

  return (
    <>
      <AuthHeading
        title={t('auth.setupTwoFactor.title')}
        subtitle={t('auth.setupTwoFactor.subtitle')}
      />
      <FormError message={error} />
      {!enrollment ? (
        <form onSubmit={start} className="flex flex-col gap-4" noValidate>
          <h2 className="font-bold text-ink">{t('auth.setupTwoFactor.step1')}</h2>
          <PasswordField
            label={t('auth.setupTwoFactor.password')}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" size="lg" fullWidth loading={pending} disabled={!password}>
            {t('auth.setupTwoFactor.start')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="font-bold text-ink">{t('auth.setupTwoFactor.step2')}</h2>
            <p className="text-sm text-ink-muted">{t('auth.setupTwoFactor.apps')}</p>
            <div
              role="img"
              aria-label={t('auth.setupTwoFactor.qrAlt')}
              className="mx-auto w-52 rounded-xl bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }}
            />
            <p className="text-sm text-ink-muted">{t('auth.setupTwoFactor.manualKey')}</p>
            <div className="flex items-center gap-2 rounded-lg bg-sunken p-2 ps-3">
              <code
                dir="ltr"
                className="flex-1 font-mono text-sm break-all text-ink"
                data-testid="totp-secret"
              >
                {enrollment.secret}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={copySecret}
                icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              >
                {copied ? t('auth.setupTwoFactor.copied') : t('auth.setupTwoFactor.copy')}
              </Button>
            </div>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-bold text-ink">{t('auth.setupTwoFactor.backupTitle')}</h2>
            <p className="text-sm text-ink-muted">{t('auth.setupTwoFactor.backupHint')}</p>
            <ul
              dir="ltr"
              className="grid grid-cols-2 gap-2 rounded-lg bg-sunken p-3 font-mono text-sm text-ink"
            >
              {enrollment.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              onClick={downloadCodes}
              icon={<Download aria-hidden />}
              className="self-start"
            >
              {t('auth.setupTwoFactor.download')}
            </Button>
          </section>
          <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
            <h2 className="font-bold text-ink">{t('auth.setupTwoFactor.step3')}</h2>
            <TextField
              label={t('auth.setupTwoFactor.code')}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.5em]"
              value={code}
              onChange={(e) =>
                setCode(toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6))
              }
            />
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={pending}
              disabled={code.length !== 6}
            >
              {t('auth.setupTwoFactor.verify')}
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
