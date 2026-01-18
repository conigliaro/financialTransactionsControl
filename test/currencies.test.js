import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { db } from '../db/indexeddb.js';
import '../components/ll-currencies-crud.js';
import '../components/ll-movement-list.js';

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

describe('Currencies catalog', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
  });

  it('seeds USD/EUR/BRL on a fresh DB and sets defaultCurrencyCode', async () => {
    await db.open();
    const currencies = await db.getAll('catalog_currencies');
    const codes = (currencies || []).map((c) => c.code).sort();
    expect(codes).toEqual(['BRL', 'EUR', 'USD']);

    const meta = await db.get('meta', 'defaultCurrencyCode');
    expect(meta?.value).toBe('EUR');
  });

  it('does not allow deleting the last remaining currency (delete disabled)', async () => {
    await db.open();
    await db.delete('catalog_currencies', 'USD');
    await db.delete('catalog_currencies', 'BRL');
    await db.put('meta', { key: 'defaultCurrencyCode', value: 'EUR' });

    document.body.innerHTML = '<ll-currencies-crud></ll-currencies-crud>';
    await customElements.whenDefined('ll-currencies-crud');
    const el = document.querySelector('ll-currencies-crud');
    await el.refresh();

    const deleteBtn = el.shadowRoot.querySelector('[data-action="delete"]');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn).toBeDisabled();
  });

  it('persists default currency selection in meta', async () => {
    await db.open();
    await db.put('meta', { key: 'defaultCurrencyCode', value: 'EUR' });

    document.body.innerHTML = '<ll-currencies-crud></ll-currencies-crud>';
    await customElements.whenDefined('ll-currencies-crud');
    const el = document.querySelector('ll-currencies-crud');
    await el.refresh();

    const usdRow = el.shadowRoot.querySelector('.crud-row[data-code="USD"]');
    expect(usdRow).not.toBeNull();
    const setDefault = usdRow.querySelector('[data-action="set-default"]');
    expect(setDefault).not.toBeNull();

    setDefault.click();
    await new Promise((r) => setTimeout(r, 0));

    const meta = await db.get('meta', 'defaultCurrencyCode');
    expect(meta?.value).toBe('USD');
  });

  it('formats movement amounts using the selected default currency', async () => {
    document.body.innerHTML = '<ll-movement-list></ll-movement-list>';
    await customElements.whenDefined('ll-movement-list');
    const list = document.querySelector('ll-movement-list');

    list.setCurrency({ code: 'BRL' });
    list.setMovements([
      {
        id: 'm1',
        date: '2025-01-01',
        vendor: 'Acme',
        expenseType: 'Food',
        docValue: 10,
        interest: 0,
        discount: 0,
        paidValue: 42.22,
        notes: '',
        status: 'draft',
      },
    ]);

    const valueEl = list.shadowRoot.querySelector('.movement-value');
    expect(valueEl).not.toBeNull();
    expect(valueEl.textContent).toMatch(/R\$/);
  });
});
