import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { db } from '../db/indexeddb.js';
import { FinancieApp } from '../financie-app.js';
import '../components/ll-company-settings.js';

async function waitUntil(predicate, { timeoutMs = 250, stepMs = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('Timed out waiting for condition');
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

describe('Company settings', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    global.fetch = async () => ({ ok: true, text: async () => 'export default {}' });
    document.body.innerHTML = '';
  });

  it('persists company name/subtitle to IndexedDB meta', async () => {
    await db.open();
    document.body.innerHTML = '<ll-company-settings></ll-company-settings>';
    await customElements.whenDefined('ll-company-settings');
    const el = document.querySelector('ll-company-settings');
    await el.refresh();

    el.shadowRoot.querySelector('#company-name').value = 'Acme Inc';
    el.shadowRoot.querySelector('#company-subtitle').value = 'My subtitle';

    const save = el.shadowRoot.querySelector('#save-btn');
    save.dispatchEvent(new Event('pointerup', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 0));
    const nameMeta = await db.get('meta', 'companyName');
    const subtitleMeta = await db.get('meta', 'companySubtitle');
    expect(nameMeta?.value).toBe('Acme Inc');
    expect(subtitleMeta?.value).toBe('My subtitle');
  });

  it('shows inline validation error and does not save when name is empty', async () => {
    await db.open();
    document.body.innerHTML = '<ll-company-settings></ll-company-settings>';
    await customElements.whenDefined('ll-company-settings');
    const el = document.querySelector('ll-company-settings');

    el.shadowRoot.querySelector('#company-name').value = '';
    el.shadowRoot.querySelector('#company-subtitle').value = 'Something';

    el.shadowRoot.querySelector('#save-btn').dispatchEvent(new Event('pointerup', { bubbles: true }));

    const err = el.shadowRoot.querySelector('#name-error');
    expect(err).not.toBeNull();
    expect(err.hidden).toBe(false);

    const nameMeta = await db.get('meta', 'companyName');
    expect(nameMeta).toBeUndefined();
  });

  it('updates header immediately after saving (no reload)', async () => {
    const app = new FinancieApp();
    await app.init();

    app.setView('company');
    const companySettings = app.appRoot.shadowRoot.querySelector('ll-company-settings');
    await companySettings.refresh();

    companySettings.shadowRoot.querySelector('#company-name').value = 'NewCo';
    companySettings.shadowRoot.querySelector('#company-subtitle').value = 'New subtitle';
    companySettings.shadowRoot.querySelector('#save-btn').dispatchEvent(new Event('pointerup', { bubbles: true }));

    await waitUntil(() => app.header.shadowRoot.querySelector('.brand-title')?.textContent === 'NewCo');

    const title = app.header.shadowRoot.querySelector('.brand-title')?.textContent;
    const subtitle = app.header.shadowRoot.querySelector('.brand-subtitle')?.textContent;
    expect(title).toBe('NewCo');
    expect(subtitle).toBe('New subtitle');
  });
});
