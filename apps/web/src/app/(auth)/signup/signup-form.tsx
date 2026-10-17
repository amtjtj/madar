'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { signupRequest, type SignupResponse } from '@madar/shared';
import { Button, TextField } from '@madar/ui';

import { AuthHeading } from '@/components/forms/auth-heading';
import { FormError } from '@/components/forms/form-error';
import { PasswordField } from '@/components/forms/password-field';
import { nextStep, useRefreshMe } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

type Field =
  'companyName' | 'slug' | 'adminName' | 'username' | 'password' | 'confirm' | 'signupCode';

export function SignupForm() {
  const router = useRouter();
  const refreshMe = useRefreshMe();
  const [values, setValues] = useState<Record<Field, string>>({
    companyName: '',
    slug: '',
    adminName: '',
    username: '',
    password: '',
    confirm: '',
    signupCode: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (field: Field) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: Partial<Record<Field, string>> = {};
    const parsed = signupRequest.safeParse({
      companyName: values.companyName,
      slug: values.slug,
      adminName: values.adminName,
      username: values.username,
      password: values.password,
      signupCode: values.signupCode || undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        errors[field] ??=
          field === 'password' ? t('errors.passwordTooShort') : t('errors.validation_failed');
      }
    }
    if (values.password !== values.confirm) errors.confirm = t('errors.passwordMismatch');
    setFieldErrors(errors);
    if (!parsed.success || Object.keys(errors).length) return;

    setPending(true);
    try {
      const result = await api<SignupResponse>('/api/tenants', {
        method: 'POST',
        body: parsed.data,
      });
      await auth.signIn(result.username, values.password);
      const me = await refreshMe();
      router.replace(nextStep(me) ?? '/');
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return (
    <>
      <AuthHeading title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')} />
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <FormError message={error} />
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-sm font-bold text-ink-subtle">
            {t('auth.signup.companySection')}
          </legend>
          <TextField
            label={t('auth.signup.companyName')}
            placeholder={t('auth.signup.companyNamePlaceholder')}
            name="companyName"
            autoComplete="organization"
            required
            value={values.companyName}
            onChange={set('companyName')}
            error={fieldErrors.companyName}
          />
          <TextField
            label={t('auth.signup.slug')}
            hint={t('auth.signup.slugHint')}
            name="slug"
            dir="ltr"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={values.slug}
            onChange={set('slug')}
            error={fieldErrors.slug}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-sm font-bold text-ink-subtle">
            {t('auth.signup.adminSection')}
          </legend>
          <TextField
            label={t('auth.signup.adminName')}
            name="adminName"
            autoComplete="name"
            required
            value={values.adminName}
            onChange={set('adminName')}
            error={fieldErrors.adminName}
          />
          <TextField
            label={t('auth.signup.username')}
            hint={t('auth.signup.usernameHint')}
            name="username"
            autoComplete="username"
            dir="ltr"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={values.username}
            onChange={set('username')}
            error={fieldErrors.username}
          />
          <PasswordField
            label={t('auth.signup.password')}
            hint={t('auth.signup.passwordHint')}
            name="password"
            autoComplete="new-password"
            required
            value={values.password}
            onChange={set('password')}
            error={fieldErrors.password}
          />
          <PasswordField
            label={t('auth.signup.confirmPassword')}
            name="confirm"
            autoComplete="new-password"
            required
            value={values.confirm}
            onChange={set('confirm')}
            error={fieldErrors.confirm}
          />
          <TextField
            label={t('auth.signup.signupCode')}
            hint={t('auth.signup.signupCodeHint')}
            name="signupCode"
            dir="ltr"
            autoComplete="off"
            value={values.signupCode}
            onChange={set('signupCode')}
          />
        </fieldset>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          {t('auth.signup.submit')}
        </Button>
      </form>
      <p className="text-center text-sm text-ink-muted">
        {t('auth.signup.haveAccount')}{' '}
        <Link href="/login" className="font-bold text-primary-ink hover:underline">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </>
  );
}
