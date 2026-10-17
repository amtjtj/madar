import type { Metadata } from 'next';
import { Suspense } from 'react';

import { t } from '@madar/i18n';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: t('auth.login.title') };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
