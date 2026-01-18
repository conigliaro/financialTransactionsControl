import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { db } from '../db/indexeddb.js';

// Mock IndexedDB
global.indexedDB = new IDBFactory();

describe('IndexedDB Wrapper', () => {
  beforeEach(async () => {
    // Clear all dbs
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      await new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(db.name);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = (e) => reject(e);
      });
    }
    // Re-open the db for each test
    await db.open();
  });

  it('should open the database and create object stores', async () => {
    const dbInfo = await db.db.name;
    expect(dbInfo).toBe('ledgerlite');
    const storeNames = Array.from(db.db.objectStoreNames);
    expect(storeNames).toContain('meta');
    expect(storeNames).toContain('movements');
    expect(storeNames).toContain('catalog_vendors');
    expect(storeNames).toContain('catalog_expense_types');
    expect(storeNames).toContain('outbox_ops');
    expect(storeNames).toContain('mappings');
  });

  it('should add and get a movement', async () => {
    const movement = { id: '1', vendor: 'Test Vendor' };
    await db.add('movements', movement);
    const result = await db.get('movements', '1');
    expect(result).toEqual(movement);
  });

  it('should get all movements', async () => {
    await db.add('movements', { id: '1' });
    await db.add('movements', { id: '2' });
    const all = await db.getAll('movements');
    expect(all.length).toBe(2);
  });

  it('should update a movement using put', async () => {
    await db.add('movements', { id: '1', vendor: 'Old Vendor' });
    await db.put('movements', { id: '1', vendor: 'New Vendor' });
    const result = await db.get('movements', '1');
    expect(result.vendor).toBe('New Vendor');
  });

  it('should delete a movement', async () => {
    await db.add('movements', { id: '1' });
    await db.delete('movements', '1');
    const result = await db.get('movements', '1');
    expect(result).toBeUndefined();
  });
  
  it('should persist and retrieve meta information', async () => {
    await db.put('meta', { key: 'theme', value: 'dark' });
    const themeMeta = await db.get('meta', 'theme');
    expect(themeMeta.value).toBe('dark');
  });
});
