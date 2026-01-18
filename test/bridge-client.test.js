import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createBridgeClient } from '../host/bridge-client.js';

describe('bridge-client security + request/response', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores RESULT from disallowed origin (request times out)', async () => {
    const hostWindow = { postMessage: vi.fn() };
    const client = createBridgeClient({
      allowedParentOrigin: 'https://allowed.test',
      parentWindow: hostWindow,
      selfWindow: window,
      debug: false,
      defaultTimeoutMs: 30,
    });

    await client.initializeBridge();

    const req = client.request({ type: 'GET_USER_PROFILE' }, 30);
    const sent = hostWindow.postMessage.mock.calls.at(-1);
    const sentMsg = sent?.[0];
    expect(typeof sentMsg?.requestId).toBe('string');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.test',
        source: hostWindow,
        data: { type: 'RESULT', requestId: sentMsg.requestId, result: { profile: { username: 'x' } } },
      }),
    );

    await expect(req).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('accepts handshake from allowed origin and correlates RESULT by requestId', async () => {
    const hostWindow = { postMessage: vi.fn() };
    const client = createBridgeClient({
      allowedParentOrigin: 'https://allowed.test',
      parentWindow: hostWindow,
      selfWindow: window,
      debug: false,
      defaultTimeoutMs: 200,
    });

    await client.initializeBridge();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://allowed.test',
        source: hostWindow,
        data: { type: 'BRIDGE_READY' },
      }),
    );

    const p = client.request({ type: 'GET_USER_PROFILE' }, 200);
    const sent = hostWindow.postMessage.mock.calls.at(-1);
    const sentMsg = sent?.[0];
    expect(sentMsg.type).toBe('GET_USER_PROFILE');
    expect(typeof sentMsg.requestId).toBe('string');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://allowed.test',
        source: hostWindow,
        data: { type: 'RESULT', requestId: sentMsg.requestId, result: { profile: { username: 'andres' } } },
      }),
    );

    const res = await p;
    expect(res.profile.username).toBe('andres');
  });
});
