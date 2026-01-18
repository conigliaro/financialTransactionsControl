import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { db } from '../db/indexeddb.js';
import { FinancieApp } from '../financie-app.js';
import { dialog } from '../components/ui-dialog.js';

async function resetIndexedDb() {
  const dbs = await indexedDB.databases();
  for (const dbInfo of dbs) {
    await new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(dbInfo.name);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = (e) => reject(e);
    });
  }
}

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

function mockTranslationFetch() {
  global.fetch = vi.fn(async () => ({ ok: true, text: async () => 'export default {}' }));
}

async function waitUntil(predicate, { timeoutMs = 200, stepMs = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('Timed out waiting for condition');
}

let originalCryptoDescriptor;

describe('Movement form save works on mobile viewport', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    mockTranslationFetch();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);

    // Simulate iOS Safari-like environment: no crypto.randomUUID, but getRandomValues exists.
    originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (arr) => {
          for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 31 + 7) & 0xff;
          return arr;
        },
      },
    });
  });

  afterEach(() => {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      try {
        // eslint-disable-next-line no-undef
        delete globalThis.crypto;
      } catch {
        // no-op
      }
    }
  });

  it('saves when clicking Save at mobile width', async () => {
    setViewportWidth(375);

    const app = new FinancieApp();
    await app.init();

    const movementForm = app.appRoot.shadowRoot.querySelector('ll-movement-form');
    movementForm.show();

    movementForm.shadowRoot.querySelector('#date').value = '2025-01-01';
    movementForm.shadowRoot.querySelector('#docValue').value = '10.00';
    movementForm.shadowRoot.querySelector('#interest').value = '0.00';
    movementForm.shadowRoot.querySelector('#discount').value = '0.00';
    movementForm.shadowRoot.querySelector('#paidValue').value = '';
    movementForm.shadowRoot.querySelector('#expenseType').value = 'Food';
    movementForm.shadowRoot.querySelector('#vendor').value = 'Vendor A';
    movementForm.shadowRoot.querySelector('#notes').value = '';

    const saveBtn = movementForm.shadowRoot.querySelector('#save-btn');
    saveBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    saveBtn.click();

    await waitUntil(async () => (await db.getAll('movements')).length === 1);
    await waitUntil(() => movementForm.style.display === 'none');

    const all = await db.getAll('movements');
    expect(all.length).toBe(1);
    expect(movementForm.style.display).toBe('none');
  });
});
