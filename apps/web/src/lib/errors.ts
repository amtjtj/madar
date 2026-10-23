import { t, type MessageKey } from '@madar/i18n';

import { ApiClientError } from './api';

const API_CODES = new Set([
  'validation_failed',
  'username_taken',
  'slug_taken',
  'signup_code_invalid',
  'invalid_password',
  'forbidden',
  'not_found',
  'conflict',
  'member_suspended',
  'tenant_locked',
  'tenant_read_only',
  'not_a_member',
  'version_conflict',
  'no_department',
  'push_endpoint_not_allowed',
  'push_disabled',
  'goal_archived',
  'goal_has_children',
  'progress_auto',
  'progress_closed',
  'file_too_large',
  'file_type_not_allowed',
  'letter_sent',
  'letter_no_recipients',
  'already_recipient',
  'evidence_not_allowed',
  'already_pinned',
  'message_edit_window',
  'chat_read_only',
  'message_empty',
  'group_owner_only',
  'meeting_canceled',
  'meeting_started',
  'ai_disabled',
  'ai_unavailable',
  'ai_failed',
  'ai_refused',
  'ai_not_for_confidential',
  'meeting_reply_closed',
  'one_on_one_needs_one',
  'meeting_time_invalid',
  'meeting_link_invalid',
  'minutes_version_conflict',
  'decision_has_task',
]);

/** Persian message for any error thrown by `api()` or the auth helpers. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return t('errors.generic');
  if (error.status === 0) return t('errors.network');
  if (error.status === 429 || error.code === 'rate_limited') return t('errors.rateLimited');
  const code = error.code ?? '';
  if (code === 'INVALID_USERNAME_OR_PASSWORD' || code === 'INVALID_EMAIL_OR_PASSWORD') {
    return t('errors.invalidCredentials');
  }
  if (code.startsWith('INVALID_') && /CODE|OTP|TOTP|BACKUP/.test(code))
    return t('errors.invalidCode');
  if (code === 'INVALID_PASSWORD') return t('errors.invalid_password');
  if (API_CODES.has(code)) return t(`errors.${code}` as MessageKey);
  if (error.status === 401) return t('errors.invalidCredentials');
  return t('errors.generic');
}
