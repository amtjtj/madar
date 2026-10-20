/** Socket.IO path (same origin as the API, proxied like /api). */
export const REALTIME_PATH = '/api/socket';

/**
 * Server → client hints. They carry no data: the client refetches through the API, which checks
 * access (ADR 0011).
 */
export const REALTIME_EVENTS = {
  /** Tasks, boards or projects the member can see changed. */
  workChanged: 'work.changed',
  /** The member's own today plan changed. */
  todayChanged: 'today.changed',
  /** The member got a new notification. */
  notificationsChanged: 'notifications.changed',
  /** A letter reached, or changed for, the member (ADR 0020). */
  lettersChanged: 'letters.changed',
  /** The member's conversations or unread counts changed (ADR 0022). */
  chatChanged: 'chat.changed',
} as const;
