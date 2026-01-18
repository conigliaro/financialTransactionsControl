import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('First run dialog', () => {
  let prevNodeEnv;
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
    dialog.style.display = 'none';
    globalThis.__ENABLE_FIRST_RUN_DIALOG_TESTS = true;
    if (globalThis.window) globalThis.window.__ENABLE_FIRST_RUN_DIALOG_TESTS = true;

    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    globalThis.__ENABLE_FIRST_RUN_DIALOG_TESTS = false;
    if (globalThis.window) globalThis.window.__ENABLE_FIRST_RUN_DIALOG_TESTS = false;
    process.env.NODE_ENV = prevNodeEnv;
  });

  it('shows on first run and persists dismissal when checked', async () => {
    const app = new FinancieApp();
    const initPromise = app.init();

    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'), { timeout: 1500 });
    expect(dialog.shadowRoot.getElementById('title')?.textContent).toBe('firstRun.title');

    const checkRow = dialog.shadowRoot.getElementById('opt-row');
    const check = dialog.shadowRoot.getElementById('opt-check');
    expect(checkRow?.hidden).toBe(false);
    expect(check?.checked).toBe(true);

    dialog.shadowRoot.getElementById('confirm-btn').click();
    await initPromise;

    const meta = await db.get('meta', 'firstRunDismissed');
    expect(meta?.value).toBe(true);

    const app2 = new FinancieApp();
    await app2.init();
    expect(dialog.style.display).toBe('none');
  });

  it('does not persist dismissal when unchecked', async () => {
    const app = new FinancieApp();
    const initPromise = app.init();

    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'), { timeout: 1500 });

    const check = dialog.shadowRoot.getElementById('opt-check');
    check.checked = false;

    dialog.shadowRoot.getElementById('confirm-btn').click();
    await initPromise;

    const meta = await db.get('meta', 'firstRunDismissed');
    expect(meta?.value).not.toBe(true);

    const app2 = new FinancieApp();
    const init2 = app2.init();
    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'), { timeout: 1500 });
    dialog.shadowRoot.getElementById('confirm-btn').click();
    await init2;
  });
});
