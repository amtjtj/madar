import type { Metadata } from 'next';
import { Suspense } from 'react';

import { t } from '@madar/i18n';

import { TwoFactorForm } from './two-factor-form';

export const metadata: Metadata = { title: t('auth.twoFactor.title') };

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
