import type { Provider } from '@nestjs/common';
import { isAllowedPushEndpoint, type PushPayload } from '@madar/shared';
import webpush from 'web-push';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `gone`: the browser dropped the subscription (404/410), so it is deleted. */
export type PushResult = 'sent' | 'gone' | 'failed';

/** Sends one push message to one device. Replaced by a fake in tests. */
export interface PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** VAPID keys from the environment, or null when push is not configured. */
export function vapidFrom(env: Env): Vapid | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const host = new URL(env.AUTH_BASE_URL).hostname;
  return {
    subject: env.VAPID_SUBJECT || `mailto:support@${host}`,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

/** Web Push over the browser vendors' push services, signed with our own VAPID keys. */
export class WebPushSender implements PushSender {
  constructor(
    private readonly vapid: Vapid | null,
    private readonly proxy: string,
  ) {}

  get enabled(): boolean {
    return this.vapid !== null;
  }

  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (!this.vapid) return 'failed';
    // Checked again here: rows written before a host was removed from the allowlist are dropped.
    if (!isAllowedPushEndpoint(target.endpoint)) return 'gone';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: this.vapid,
          // A day-old «you have a new task» is noise; drop it if the phone stays offline.
          TTL: 12 * 60 * 60,
          urgency: 'normal',
          timeout: 10_000,
          contentEncoding: 'aes128gcm',
          ...(this.proxy ? { proxy: this.proxy } : {}),
        },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? 'gone' : 'failed';
    }
  }
}

export const pushSenderProvider: Provider = {
  provide: PUSH_SENDER,
  inject: [ENV],
  useFactory: (env: Env) => new WebPushSender(vapidFrom(env), env.PUSH_PROXY_URL),
};
