import { z } from 'zod';

import { NOTIFICATION_KINDS, NOTIFICATION_SUBJECTS } from './notifications.js';

/**
 * Push services of the major browsers. The worker POSTs to a subscription's endpoint, which the
 * browser chooses, so only these hosts (https, default port) are accepted: no request to an
 * arbitrary address can be planted through a subscription (SSRF).
 */
// URL exists in browsers and Node; this package compiles without DOM or Node typings.
declare const URL: new (input: string) => {
  protocol: string;
  port: string;
  username: string;
  password: string;
  hostname: string;
};

const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com'];
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/);

/** `PushSubscription.toJSON()` from the browser. */
export const pushSubscriptionRequest = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: base64url.max(200), auth: base64url.max(100) }),
});
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequest>;

export const deletePushSubscriptionRequest = z.object({ endpoint: z.url().max(2048) });
export type DeletePushSubscriptionRequest = z.infer<typeof deletePushSubscriptionRequest>;

export const pushConfig = z.object({
  /** False when the server has no VAPID keys: the UI hides device notifications. */
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
});
export type PushConfig = z.infer<typeof pushConfig>;

/**
 * What a push message carries. No titles, names or other company text: the service worker builds
 * a generic Persian sentence from `kind` and `count` (push services belong to browser vendors).
 */
export const pushPayload = z.object({
  v: z.literal(1),
  kind: z.enum([...NOTIFICATION_KINDS, 'test']),
  /** Unread notifications this push stands for; more than one shows «n new notifications». */
  count: z.number().int().min(1),
  /** For a single notification: where a tap opens. */
  subject: z.object({ type: z.enum(NOTIFICATION_SUBJECTS), id: z.uuid() }).nullable(),
});
export type PushPayload = z.infer<typeof pushPayload>;
