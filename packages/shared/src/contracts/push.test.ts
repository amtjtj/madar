import { describe, expect, it } from 'vitest';

import { isAllowedPushEndpoint, pushPayload } from './push.js';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://web.push.apple.com/QGx1',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ])('accepts the browser push service %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pw@fcm.googleapis.com/x',
    'https://storage.googleapis.com/bucket',
    'https://push.apple.com.evil.example/x',
    'https://evilpush.apple.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'not a url',
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('pushPayload', () => {
  it('carries no free text', () => {
    expect(Object.keys(pushPayload.shape).sort()).toEqual(['count', 'kind', 'subject', 'v']);
  });
});
