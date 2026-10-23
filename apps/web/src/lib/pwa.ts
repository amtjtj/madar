import type { PushConfig } from '@madar/shared';

import { api } from './api';

/** Browser helpers for the installable app and device push (no React). */

/** VAPID public key (base64url) → the bytes `pushManager.subscribe` wants. */
export function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** iPhone and iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Running as the installed app (home screen), not in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The browser's push subscription on this device, if any. */
/** Where the service worker lives (offline page, push); registered on every app load. */
export const SERVICE_WORKER = { url: '/sw.js', scope: '/' } as const;

/**
 * The active service worker, registering it first when the load-time registration did not
 * happen or failed (a slow first compile, a flaky network); otherwise `ready` would wait forever.
 * A failed registration rejects, so the caller can say so.
 */
export async function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration(SERVICE_WORKER.scope))) {
    await navigator.serviceWorker.register(SERVICE_WORKER.url, {
      scope: SERVICE_WORKER.scope,
      updateViaCache: 'none',
    });
  }
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Android/Chrome's install prompt arrives once, possibly before any screen that offers it is
 * mounted; it is kept here until used. Listeners re-render the install buttons.
 */
const install = {
  event: null as BeforeInstallPromptEvent | null,
  installed: false,
  listeners: new Set<() => void>(),
  captured: false,
};

function notify() {
  for (const listener of install.listeners) listener();
}

export function captureInstallPrompt(): void {
  if (install.captured || typeof window === 'undefined') return;
  install.captured = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    install.event = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    install.event = null;
    install.installed = true;
    notify();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  install.listeners.add(listener);
  return () => install.listeners.delete(listener);
}

export function installState(): { canPrompt: boolean; installed: boolean } {
  return { canPrompt: install.event !== null, installed: install.installed };
}

/** Shows the browser's install dialog; true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = install.event;
  if (!event) return false;
  install.event = null;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

export const INSTALL_CARD_DISMISSED_KEY = 'madar.install-card-dismissed';

export type DevicePushStatus =
  | 'loading'
  | 'disabled' // the server has no VAPID keys
  | 'unsupported'
  | 'ios-install' // iPhone in Safari: push works only in the installed app
  | 'denied'
  | 'off'
  | 'on';

export function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return { endpoint: json.endpoint, keys: json.keys };
}

/** Where this device stands (the app shell keeps the server in step, see `syncDevicePush`). */
export async function detectPushStatus(
  config: PushConfig,
  platform: { ios: boolean; standalone: boolean },
): Promise<DevicePushStatus> {
  if (!config.enabled) return 'disabled';
  if (!pushSupported()) return platform.ios && !platform.standalone ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = await currentSubscription().catch(() => null);
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Who this browser's subscription was made for (`tenant:member`). */
const OWNER_KEY = 'madar.push-owner';

export function setPushOwner(owner: string | null): void {
  try {
    if (owner) localStorage.setItem(OWNER_KEY, owner);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Storage blocked: the next sync simply renews the subscription.
  }
}

function pushOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps this browser's subscription with the signed-in member. When someone else (or the same
 * person in another company) used the browser before without signing out, the subscription is
 * renewed: the old endpoint then answers «gone» and every company drops it.
 */
export async function syncDevicePush(owner: string, publicKey: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  let subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  if (pushOwner() !== owner) {
    await subscription.unsubscribe();
    const registration = await serviceWorkerReady();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    });
  }
  await api('/api/push/subscriptions', { method: 'POST', body: subscriptionBody(subscription) });
  setPushOwner(owner);
}

/**
 * Stops push on this device: the server forgets it and the browser drops the subscription.
 * Called on sign-out (shared phones) while the session is still valid.
 */
export async function removeDevicePush(): Promise<void> {
  setPushOwner(null);
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  // Never hold up signing out on a slow network: the browser side below is what matters most.
  await Promise.race([
    api('/api/push/subscriptions', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
    }).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await subscription.unsubscribe().catch(() => undefined);
}
