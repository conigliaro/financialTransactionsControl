import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => key,
}));

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

describe('Movement save error dialog', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
  });

  it('shows a custom error dialog when saving throws', async () => {
    const app = new FinancieApp();
    await app.init();

    vi.spyOn(db, 'add').mockRejectedValueOnce(new Error('boom'));

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

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(dialog.style.display).toBe('flex');
    const title = dialog.shadowRoot.getElementById('title');
    expect(title?.textContent).toBe('save.error.title');
  });
});

