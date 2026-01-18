import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { db } from '../db/indexeddb.js';
import { FinancieApp } from '../financie-app.js';
import { dialog } from '../components/ui-dialog.js';

async function resetIndexedDb() {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    await new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(db.name);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = (e) => reject(e);
    });
  }
}

function mockTranslationFetch({ es = null } = {}) {
  global.fetch = vi.fn(async (url) => {
    const requestedLang = String(url).split('/').pop().replace('.js', '');
    if (requestedLang === 'es' && es) {
      return {
        ok: true,
        text: async () => `export default ${JSON.stringify(es)}`,
      };
    }
    return { ok: true, text: async () => `export default {}` };
  });
}

describe('FinancieApp CRUD + UI constraints', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();

    mockTranslationFetch({
      es: {
        'company.name': 'Nombre de la Empresa',
        'header.subtitle': 'Registra gastos en segundos',
      },
    });

    document.body.innerHTML = '';
    document.body.appendChild(dialog);
  });

  it('creates a movement with status="draft" and no status UI', async () => {
    const app = new FinancieApp();
    await app.init();

    const movementForm = app.appRoot.shadowRoot.querySelector('ll-movement-form');
    expect(movementForm.shadowRoot.querySelector('#status')).toBeNull();

    movementForm.show();
    movementForm.shadowRoot.querySelector('#date').value = '2025-01-01';
    movementForm.shadowRoot.querySelector('#docValue').value = '10.00';
    movementForm.shadowRoot.querySelector('#interest').value = '2.00';
    movementForm.shadowRoot.querySelector('#discount').value = '1.00';
    movementForm.shadowRoot.querySelector('#paidValue').value = '';
    movementForm.shadowRoot.querySelector('#expenseType').value = 'Food';
    movementForm.shadowRoot.querySelector('#vendor').value = 'Vendor A';
    movementForm.shadowRoot.querySelector('#notes').value = '';

    const form = movementForm.shadowRoot.querySelector('form');
    await app.saveMovement(form, movementForm.editingMovementId, movementForm.editingMovementStatus);
    movementForm.hide();

    const all = await db.getAll('movements');
    expect(all.length).toBe(1);
    expect(all[0].status).toBe('draft');
    expect(all[0].txnType).toBe('income');

    const movementList = app.appRoot.shadowRoot.querySelector('ll-movement-list');
    expect(movementList.shadowRoot.querySelector('.status-badge')).toBeNull();
  });

  it('edits an existing movement and preserves status', async () => {
    await db.open();
    await db.add('movements', {
      id: 'm1',
      txnType: 'income',
      date: '2025-01-02',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Vendor A',
      notes: '',
      status: 'sent',
    });

    const app = new FinancieApp();
    await app.init();

    await app.handleEdit('m1');

    const movementForm = app.appRoot.shadowRoot.querySelector('ll-movement-form');
    expect(movementForm.editingMovementId).toBe('m1');
    expect(movementForm.editingMovementStatus).toBe('sent');

    movementForm.shadowRoot.querySelector('#vendor').value = 'Vendor B';
    const form = movementForm.shadowRoot.querySelector('form');
    await app.saveMovement(form, movementForm.editingMovementId, movementForm.editingMovementStatus);
    movementForm.hide();

    const updated = await db.get('movements', 'm1');
    expect(updated.vendor).toBe('Vendor B');
    expect(updated.status).toBe('sent');
    expect(updated.txnType).toBe('income');
  });

  it('deletes a movement after custom confirmation dialog', async () => {
    await db.open();
    await db.add('movements', {
      id: 'm1',
      date: '2025-01-02',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Vendor A',
      notes: '',
      status: 'draft',
    });

    dialog.confirm = vi.fn().mockResolvedValue(true);

    const app = new FinancieApp();
    await app.init();

    await app.handleDelete('m1');

    const all = await db.getAll('movements');
    expect(all).toEqual([]);
  });

  it('uses persisted language preference from IndexedDB meta', async () => {
    await db.open();
    await db.put('meta', { key: 'language', value: 'es' });

    const app = new FinancieApp();
    await app.init();
    await new Promise((r) => setTimeout(r, 0));

    const brandTitle = app.header.shadowRoot.querySelector('.brand-title')?.textContent;
    expect(brandTitle).toBe('Nombre de la Empresa');
  });
});
