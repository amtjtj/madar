'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { PushConfig } from '@madar/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { api } from '@/lib/api';
import {
  captureInstallPrompt,
  detectPushStatus,
  installState,
  isIos,
  isStandalone,
  promptInstall,
  removeDevicePush,
  subscribeInstall,
  subscriptionBody,
  urlBase64ToBytes,
  type DevicePushStatus,
} from '@/lib/pwa';

import { pushKeys } from './keys';

/** Registers the service worker (offline page, push) and keeps the install prompt. */
export function useServiceWorker(): void {
  useEffect(() => {
    captureInstallPrompt();
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => undefined);
  }, []);
}

interface Platform {
  ready: boolean;
  ios: boolean;
  standalone: boolean;
}

/** Device facts known only in the browser (false/unknown during server rendering). */
function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>({
    ready: false,
    ios: false,
    standalone: false,
  });
  useEffect(() => {
    // Read once after mount: the server render cannot know the device.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform({
      ready: true,
      ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
      standalone: isStandalone(),
    });
  }, []);
  return platform;
}

const serverInstall = { canPrompt: false, installed: false };
let lastInstall = serverInstall;
function installSnapshot() {
  const next = installState();
  if (next.canPrompt !== lastInstall.canPrompt || next.installed !== lastInstall.installed) {
    lastInstall = next;
  }
  return lastInstall;
}

/**
 * Whether the app can be installed here and how: Android/Chrome shows the browser's dialog,
 * iPhone needs «Add to Home Screen» by hand. `installed` once running from the home screen.
 */
export function useInstall() {
  const platform = usePlatform();
  const state = useSyncExternalStore(subscribeInstall, installSnapshot, () => serverInstall);
  const installed = platform.standalone || state.installed;
  return {
    ready: platform.ready,
    installed,
    canPrompt: !installed && state.canPrompt,
    iosManual: !installed && platform.ios,
    install: promptInstall,
  };
}

export function usePushConfig() {
  return useQuery({
    queryKey: pushKeys.config,
    queryFn: () => api<PushConfig>('/api/push/config'),
    staleTime: Infinity,
  });
}

export type { DevicePushStatus };

/** This device's push subscription: status plus turn on / turn off / send a test. */
export function useDevicePush() {
  const { data: config } = usePushConfig();
  const platform = usePlatform();
  const [status, setStatus] = useState<DevicePushStatus>('loading');

  useEffect(() => {
    if (!config || !platform.ready) return;
    let alive = true;
    void detectPushStatus(config, platform).then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [config, platform]);

  const enable = useMutation({
    mutationFn: async () => {
      if (!config?.publicKey) throw new Error('push disabled');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off');
        return false;
      }
      const registration = await navigator.serviceWorker.ready;
      const key = urlBase64ToBytes(config.publicKey);
      let subscription = await registration.pushManager.getSubscription();
      const existingKey = subscription?.options.applicationServerKey;
      if (
        subscription &&
        existingKey &&
        !new Uint8Array(existingKey).every((byte, i) => byte === key[i])
      ) {
        // Subscribed with old server keys: start over.
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await api('/api/push/subscriptions', {
        method: 'POST',
        body: subscriptionBody(subscription),
      });
      setStatus('on');
      return true;
    },
  });

  const disable = useMutation({
    mutationFn: async () => {
      await removeDevicePush();
      setStatus('off');
    },
  });

  const test = useMutation({
    mutationFn: () => api<{ sent: number }>('/api/push/test', { method: 'POST' }),
  });

  return { status, enable, disable, test };
}
