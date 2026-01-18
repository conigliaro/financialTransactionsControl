import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => key,
}));

import '../components/ui-bottom-sheet.js';
import { dialog } from '../components/ui-dialog.js';
import { FinancieApp } from '../financie-app.js';

function dispatchEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

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

describe('Modal dismissal behaviors (ESC + backdrop)', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
    dialog.style.display = 'none';
  });

  it('ui-dialog closes on Escape and resolves confirm as false', async () => {
    const p = dialog.confirm({ title: 't', message: 'm', confirmLabel: 'yes', cancelLabel: 'no' });
    expect(dialog.style.display).toBe('flex');

    dispatchEscape();
    const res = await p;
    expect(res).toBe(false);
    expect(dialog.style.display).toBe('none');
  });

  it('ui-dialog closes on backdrop click, but not on panel click', async () => {
    const p = dialog.confirm({ title: 't', message: 'm', confirmLabel: 'yes', cancelLabel: 'no' });
    expect(dialog.style.display).toBe('flex');

    const panel = dialog.shadowRoot.getElementById('dialog-panel');
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(dialog.style.display).toBe('flex');

    const overlay = dialog.shadowRoot.getElementById('dialog-overlay');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    const res = await p;
    expect(res).toBe(false);
    expect(dialog.style.display).toBe('none');
  });

  it('bottom sheet closes on global Escape via modal stack', async () => {
    const sheet = document.createElement('ui-bottom-sheet');
    document.body.appendChild(sheet);

    const p = sheet.open({
      title: 'Month',
      items: [
        { value: '1', label: 'Jan' },
        { value: '2', label: 'Feb' },
      ],
      selectedValue: '1',
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    expect(sheet.style.display).toBe('block');

    dispatchEscape();
    const res = await p;
    expect(res).toBe(null);
    expect(sheet.style.display).toBe('none');
  });

  it('Escape closes only the top-most modal (stacked)', async () => {
    const sheet = document.createElement('ui-bottom-sheet');
    document.body.appendChild(sheet);
    const sheetPromise = sheet.open({
      title: 'Menu',
      items: [{ value: 'a', label: 'A' }],
      selectedValue: null,
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    expect(sheet.style.display).toBe('block');

    const dialogPromise = dialog.confirm({ title: 't', message: 'm', confirmLabel: 'yes', cancelLabel: 'no' });
    expect(dialog.style.display).toBe('flex');

    dispatchEscape();
    await expect(dialogPromise).resolves.toBe(false);
    expect(dialog.style.display).toBe('none');
    expect(sheet.style.display).toBe('block');

    dispatchEscape();
    await expect(sheetPromise).resolves.toBe(null);
    expect(sheet.style.display).toBe('none');
  });

  it('movement form closes on Escape when open', async () => {
    const app = new FinancieApp();
    await app.init();

    const form = app.appRoot.shadowRoot.querySelector('ll-movement-form');
    form.show();
    expect(form.style.display).toBe('flex');

    dispatchEscape();
    expect(form.style.display).toBe('none');
  });
});
