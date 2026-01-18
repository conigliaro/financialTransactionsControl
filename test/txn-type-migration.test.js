import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { db } from '../db/indexeddb.js';

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

async function seedV2DatabaseWithoutTxnType() {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('ledgerlite', 2);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('movements')) {
        db.createObjectStore('movements', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction(['movements'], 'readwrite');
      tx.objectStore('movements').put({
        id: 'm1',
        date: '2025-01-01',
        docValue: 1,
        interest: 0,
        discount: 0,
        paidValue: 1,
        expenseType: 'Food',
        vendor: 'Acme',
        notes: '',
        status: 'draft',
        // txnType intentionally missing
      });
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = (e) => reject(e);
    };
    req.onerror = (e) => reject(e);
  });
}

describe('txnType migration', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
  });

  it('defaults missing txnType to expense during DB upgrade', async () => {
    await seedV2DatabaseWithoutTxnType();
    await db.open(); // opens at latest version (v3)
    const m1 = await db.get('movements', 'm1');
    expect(m1.txnType).toBe('expense');
  });
});

