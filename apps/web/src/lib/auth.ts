import { toLatinDigits } from '@madar/shared';

import { api } from './api';

/** Thin wrappers over the Better Auth endpoints the web uses. */
export const auth = {
  signIn: (username: string, password: string) =>
    api<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/username', {
      method: 'POST',
      body: { username: toLatinDigits(username).trim().toLowerCase(), password },
    }),

  verifyTotp: (code: string) =>
    api<unknown>('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: toLatinDigits(code).replace(/\s/g, '') },
    }),

  verifyBackupCode: (code: string) =>
    api<unknown>('/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      body: { code: toLatinDigits(code).trim() },
    }),

  enableTwoFactor: (password: string) =>
    api<{ totpURI: string; backupCodes: string[] }>('/api/auth/two-factor/enable', {
      method: 'POST',
      body: { password },
    }),

  signOut: () => api<unknown>('/api/auth/sign-out', { method: 'POST', body: {} }),
};

/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
