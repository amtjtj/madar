import type { MetadataRoute } from 'next';

import { t } from '@madar/i18n';

// Installable app (PWA). Colors match the light theme's canvas and the logo (`public/icons`).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: t('app.name'),
    short_name: t('pwa.shortName'),
    description: t('app.tagline'),
    lang: 'fa',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fbfaf6',
    theme_color: '#0f8a6a',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: t('nav.today'), url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      {
        name: t('tasks.tabs.mine'),
        url: '/tasks',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: t('notifications.title'),
        url: '/notifications',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
