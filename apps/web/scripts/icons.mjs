// Renders the PWA icons from the SVG sources in public/icons with the local Chromium (no online
// service). Run after changing a logo: `node scripts/icons.mjs` from apps/web.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const dir = resolve(import.meta.dirname, '../public/icons');
const targets = [
  ['icon.svg', 192, 'public/icons/icon-192.png'],
  ['icon.svg', 512, 'public/icons/icon-512.png'],
  ['maskable.svg', 512, 'public/icons/maskable-512.png'],
  // iOS rounds the corners itself, so the full-bleed artwork is used.
  ['maskable.svg', 180, 'src/app/apple-icon.png'],
  ['badge.svg', 96, 'public/icons/badge-96.png'],
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const page = await browser.newPage();
for (const [source, size, out] of targets) {
  const svg = readFileSync(resolve(dir, source), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: resolve(import.meta.dirname, '..', out), omitBackground: true });
}
await browser.close();
