import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => {
    const map = {
      'send.error.title': 'Send failed',
      'send.error.details': 'Details',
      'send.error.codeLabel': 'Code',
      'send.error.messageLabel': 'Message',
      'send.error.generic': 'Could not send the transaction.',
      'send.error.category_not_found': 'The selected category was not found in Finanzas.',
      close: 'Close',
      'copy.details': 'Copy details',
      'movement.details.title': 'Movement details',
      'company.name': 'Company Name',
      'header.subtitle': 'Track expenses in seconds',
      'user.anonymous': 'Anonymous',
      'user.menu': 'User menu',
      period: 'Period',
      back: 'Back',
      'export.csv': 'Export CSV',
      month: 'Month',
      year: 'Year',
      menu: 'Menu',
      vendors: 'Vendors',
      'expense.types': 'Expense types',
      'menu.currencies': 'Currencies',
      'menu.company': 'Company',
      preferences: 'Preferences',
      language: 'Language',
      'toggle.theme': 'Toggle theme',
      date: 'Date',
      'paid.value': 'Paid value',
    };
    return map[key] || key;
  },
}));

import { dialog } from '../components/ui-dialog.js';
import { __resetBridgeForTests, __setBridgeForTests } from '../host/bridge-client.js';
import { FinancieApp } from '../financie-app.js';
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

describe('Send error dialog shows real bridge error', () => {
  beforeEach(async () => {
    __resetBridgeForTests();
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
    dialog.style.display = 'none';
  });

  it('shows host message + code for CATEGORY_NOT_FOUND', async () => {
    vi.spyOn(dialog, 'confirm').mockResolvedValue(true);
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => true,
      waitForReady: vi.fn(async () => true),
      getActiveOrigin: () => 'https://mybudgetsocial.com',
      request: vi.fn(async (msg) => {
        if (msg?.type === 'GET_USER_PROFILE') return { profile: { username: '' } };
        return {};
      }),
      sendTransactionToHost: vi.fn(async () => {
        const e = new Error('Category not found');
        e.code = 'CATEGORY_NOT_FOUND';
        e.raw = { code: 'CATEGORY_NOT_FOUND', message: 'Category not found' };
        throw e;
      }),
    });

    const app = new FinancieApp();
    await app.init();
    await db.add('movements', {
      id: 'm_err',
      rev: 1,
      txnType: 'income',
      date: '2026-01-18',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Acme',
      notes: '',
      status: 'draft',
    });

    await app.handleSend('m_err');
    await new Promise((r) => setTimeout(r, 0));

    expect(dialog.style.display).toBe('flex');
    expect(dialog.shadowRoot.getElementById('title')?.textContent).toBe('Send failed');
    expect(dialog.shadowRoot.getElementById('message')?.textContent).toContain('Category not found');
    expect(dialog.shadowRoot.getElementById('details-pre')?.textContent).toContain('CATEGORY_NOT_FOUND');
  });
});
