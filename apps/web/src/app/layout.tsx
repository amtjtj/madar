import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: t('app.name'),
  description: t('app.tagline'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
