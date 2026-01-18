import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createBridgeClient } from '../host/bridge-client.js';

describe('bridge-client security + request/response', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores messages from disallowed origins and stays not-ready', async () => {
    const parentWindow = { postMessage: vi.fn() };
    const client = createBridgeClient({
      allowedOrigins: ['https://allowed.test'],
      parentWindow,
      selfWindow: window,
    });

    await client.initializeBridge();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.test',
        source: parentWindow,
        data: { type: 'BRIDGE_READY' },
      }),
    );

    expect(client.isReady()).toBe(false);
    await expect(client.sendTransactionToHost({ a: 1 }, 'm1:1')).rejects.toMatchObject({ code: 'HOST_NOT_CONNECTED' });
  });

  it('accepts handshake from allowed origin, correlates request/response, and targets activeOrigin', async () => {
    const parentWindow = { postMessage: vi.fn() };
    const client = createBridgeClient({
      allowedOrigins: ['https://allowed.test'],
      parentWindow,
      selfWindow: window,
    });

    await client.initializeBridge();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://allowed.test',
        source: parentWindow,
        data: { type: 'BRIDGE_READY' },
      }),
    );

    expect(client.isReady()).toBe(true);
    expect(client.getActiveOrigin()).toBe('https://allowed.test');

    const p = client.sendTransactionToHost({ amount: 1 }, 'm1:1', { timeoutMs: 2000 });
    expect(parentWindow.postMessage).toHaveBeenCalled();

    const sent = parentWindow.postMessage.mock.calls.at(-1);
    const sentMsg = sent?.[0];
    const sentOrigin = sent?.[1];
    expect(sentOrigin).toBe('https://allowed.test');
    expect(sentMsg.type).toBe('MBS_SEND_TRANSACTION');
    expect(typeof sentMsg.requestId).toBe('string');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://allowed.test',
        source: parentWindow,
        data: {
          type: 'MBS_SEND_TRANSACTION_RESULT',
          requestId: sentMsg.requestId,
          status: 'success',
          remoteTxnId: 'remote_123',
        },
      }),
    );

    const res = await p;
    expect(res.remoteTxnId).toBe('remote_123');
  });
});

