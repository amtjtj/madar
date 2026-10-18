/**
 * The worker's heartbeat (plan phase-1-step-9 §2): a Redis key it refreshes every
 * `HEARTBEAT_INTERVAL_MS`. It holds only a timestamp, never tenant data.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TTL_SECONDS = 90;

export function heartbeatKey(prefix: string): string {
  return `${prefix}:worker:heartbeat`;
}
