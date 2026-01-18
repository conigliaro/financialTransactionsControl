import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { uuidv4 } from '../utils/uuid.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let originalCryptoDescriptor;

function setCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true });
}

describe('uuidv4()', () => {
  beforeEach(() => {
    originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  });

  afterEach(() => {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      // best effort remove
      // eslint-disable-next-line no-undef
      try { delete globalThis.crypto; } catch { /* no-op */ }
    }
  });

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.fn(() => '00000000-0000-4000-8000-000000000000');
    setCrypto({ randomUUID: spy });
    const id = uuidv4();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(id).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('falls back to crypto.getRandomValues when randomUUID is absent', () => {
    setCrypto({
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 17 + 3) & 0xff;
        return arr;
      },
    });
    const id = uuidv4();
    expect(id).toMatch(UUID_V4_RE);
  });

  it('falls back to Math.random when crypto is absent', () => {
    setCrypto(undefined);
    const id = uuidv4();
    expect(id).toMatch(UUID_V4_RE);
  });
});

