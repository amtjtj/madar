#!/usr/bin/env node
// Copies the licensed Abar Low font files into apps/web/public/fonts/abar (git-ignored).
// Usage: pnpm fonts:install <directory-with-AbarLow-files>
// Accepts .woff2 (preferred) or .ttf; file names only need to contain e.g. "AbarLow-Bold".
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const source = process.argv[2];
if (!source || !existsSync(source)) {
  console.error('Usage: pnpm fonts:install <directory-with-AbarLow-files>');
  process.exit(1);
}

const target = resolve(import.meta.dirname, '../apps/web/public/fonts/abar');
mkdirSync(target, { recursive: true });

const pattern = /AbarLow-(Thin|Light|Regular|Bold|Black)\.(woff2|ttf)$/i;
const styles = ['Thin', 'Light', 'Regular', 'Bold', 'Black'];
const found = new Set();

for (const file of readdirSync(source)) {
  const match = file.match(pattern);
  if (!match) continue;
  const style = styles.find((s) => s.toLowerCase() === match[1].toLowerCase());
  const ext = match[2].toLowerCase();
  copyFileSync(join(source, file), join(target, `AbarLow-${style}.${ext}`));
  found.add(style);
  console.warn(`installed AbarLow-${style}.${ext}`);
}

const missing = styles.filter((s) => !found.has(s));
if (found.size === 0) {
  console.error('No AbarLow-* .woff2/.ttf files found in', source);
  process.exit(1);
}
if (missing.length)
  console.warn('Missing weights (the browser will use the nearest):', missing.join(', '));
if (!found.has('Regular')) console.warn('AbarLow-Regular is required for the font to be enabled.');
