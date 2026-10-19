import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes the web maps to Persian messages (the API never sends UI text).
 * Response body: { error: { code, message } } — `message` is for developers.
 */
export type ErrorCode =
  | 'unauthenticated'
  | 'tenant_selection_required'
  | 'not_a_member'
  | 'member_suspended'
  | 'tenant_locked'
  | 'tenant_read_only'
  | 'password_change_required'
  | 'two_factor_setup_required'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'username_taken'
  | 'slug_taken'
  | 'signup_code_invalid'
  | 'invalid_password'
  | 'rate_limited'
  | 'version_conflict'
  | 'no_department'
  | 'push_endpoint_not_allowed'
  | 'push_disabled'
  | 'goal_archived'
  | 'goal_has_children'
  | 'progress_auto'
  | 'progress_closed'
  | 'file_too_large'
  | 'file_type_not_allowed'
  | 'letter_sent'
  | 'letter_no_recipients'
  | 'already_recipient'
  | 'conflict';

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ error: { code, message, ...(details ? { details } : {}) } }, status);
  }
}

export const unauthenticated = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Sign in required');
export const forbidden = (message = 'Not allowed') =>
  new ApiError(HttpStatus.FORBIDDEN, 'forbidden', message);
export const notFound = (what = 'Resource') =>
  new ApiError(HttpStatus.NOT_FOUND, 'not_found', `${what} not found`);
