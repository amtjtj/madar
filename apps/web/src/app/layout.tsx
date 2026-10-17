import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import { themeScript } from '@madar/ui';

import { Providers } from './providers';
import './globals.css';

// Fallback typeface (open license, in git). Not preloaded: Abar Low is the primary face.
const vazirmatn = localFont({
  src: '../../../../packages/ui/fonts/Vazirmatn-Variable.woff2',
  variable: '--font-vazirmatn',
  weight: '100 900',
  display: 'swap',
  preload: false,
});

// Primary typeface: Abar Low (Fontiran, licensed). Its files are git-ignored and installed per
// environment with `pnpm fonts:install`; without them the UI falls back to Vazirmatn.
const ABAR_DIR = join(process.cwd(), 'public/fonts/abar');
const abarFonts = ['Regular', 'Bold'].filter((style) =>
  existsSync(join(ABAR_DIR, `AbarLow-${style}.woff2`)),
);
const hasAbar = abarFonts.includes('Regular') || existsSync(join(ABAR_DIR, 'AbarLow-Regular.ttf'));

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
        {hasAbar && (
          <>
            {abarFonts.map((style) => (
              <link
                key={style}
                rel="preload"
                href={`/fonts/abar/AbarLow-${style}.woff2`}
                as="font"
                type="font/woff2"
                crossOrigin=""
              />
            ))}
            {/* eslint-disable-next-line @next/next/no-css-tags -- static @font-face file in public/ */}
            <link rel="stylesheet" href="/fonts/abar/fonts.css" />
          </>
        )}
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
