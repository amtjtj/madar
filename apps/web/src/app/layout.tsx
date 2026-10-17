import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import { themeScript } from '@madar/ui';

import { Providers } from './providers';
import './globals.css';

// Self-hosted variable font (100–900); no request leaves our servers.
const vazirmatn = localFont({
  src: '../../../../packages/ui/fonts/Vazirmatn-Variable.woff2',
  variable: '--font-vazirmatn',
  weight: '100 900',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
  description: t('app.tagline'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf6' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1420' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
