import type { Metadata } from 'next';

import { t } from '@madar/i18n';

import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: t('auth.signup.title') };

export default function SignupPage() {
  return <SignupForm />;
}
