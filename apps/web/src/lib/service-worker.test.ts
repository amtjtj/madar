import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { serviceWorkerScript } from './service-worker';

/** Runs the worker in a sandbox and returns its event listeners plus what it showed. */
function load() {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
  const self = {
    location: { origin: 'https://madar.example' },
    navigator: {},
    registration: {
      showNotification: (title: string, options: (typeof shown)[number]['options']) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {},
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
  };
  runInNewContext(serviceWorkerScript(), { self, caches: {}, fetch, Response, URL, Promise });
  const push = (data: unknown) =>
    listeners.get('push')?.({ data: { json: () => data }, waitUntil: () => undefined });
  return { listeners, shown, push };
}

describe('service worker', () => {
  it('handles install, activate, fetch, push and notification taps', () => {
    expect([...load().listeners.keys()].sort()).toEqual([
      'activate',
      'fetch',
      'install',
      'notificationclick',
      'push',
    ]);
  });

  it('shows a generic sentence for one notification and opens its task', () => {
    const { shown, push } = load();
    const id = '0199f0aa-1111-7222-8333-944445555666';
    push({ v: 1, kind: 'task_assigned', count: 1, subject: { type: 'task', id } });
    expect(shown[0]?.title).toBe('مدار');
    expect(shown[0]?.options.body).toBe('یک کار تازه به تو سپرده شد');
    expect(shown[0]?.options.data.url).toBe(`/tasks/${id}`);
  });

  it('summarises several notifications with Persian digits and opens the list', () => {
    const { shown, push } = load();
    push({ v: 1, kind: 'task_commented', count: 3, subject: null });
    expect(shown[0]?.options.body).toBe('۳ اعلان تازه در مدار');
    expect(shown[0]?.options.data.url).toBe('/notifications');
  });

  it('never caches API responses', () => {
    expect(serviceWorkerScript()).not.toMatch(/\/api\//);
  });
});
