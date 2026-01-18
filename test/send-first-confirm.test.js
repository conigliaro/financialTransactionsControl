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
import { __resetBridgeForTests, __setBridgeForTests } from '../host/bridge-client.js';

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

describe('First-time send confirmation', () => {
  beforeEach(async () => {
    __resetBridgeForTests();
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
    dialog.style.display = 'none';
  });

  it('shows confirm dialog on first successful send attempt and cancel does nothing', async () => {
    const sendTransactionToHost = vi.fn(async () => ({ status: 'success', remoteTxnId: 'r1' }));
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => true,
      waitForReady: vi.fn(async () => true),
      getActiveOrigin: () => 'https://mybudgetsocial.com',
      sendTransactionToHost,
      getUserProfile: vi.fn(),
      request: vi.fn(async (msg) => {
        if (msg?.type === 'GET_USER_PROFILE') return { profile: { username: '' } };
        return {};
      }),
    });

    const app = new FinancieApp();
    await app.init();

    await db.add('movements', {
      id: 'm1',
      rev: 1,
      txnType: 'income',
      date: '2026-01-01',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Acme',
      notes: '',
      status: 'draft',
    });

    const p = app.handleSend('m1');
    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'));
    expect(dialog.shadowRoot.getElementById('title')?.textContent).toBe('send.confirmFirst.title');

    dialog.shadowRoot.getElementById('cancel-btn').click();
    await p;

    expect(sendTransactionToHost).not.toHaveBeenCalled();
    const attempts = await db.getAllByIndex('movement_send_attempts', 'movementId', 'm1');
    expect(attempts).toHaveLength(0);
  });

  it('confirming triggers send and shows sending indicator', async () => {
    let resolveSend;
    const sendTransactionToHost = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => true,
      waitForReady: vi.fn(async () => true),
      getActiveOrigin: () => 'https://mybudgetsocial.com',
      sendTransactionToHost,
      getUserProfile: vi.fn(),
      request: vi.fn(async (msg) => {
        if (msg?.type === 'GET_USER_PROFILE') return { profile: { username: '' } };
        return {};
      }),
    });

    const app = new FinancieApp();
    await app.init();

    await db.add('movements', {
      id: 'm2',
      rev: 1,
      txnType: 'expense',
      date: '2026-01-02',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Acme',
      notes: '',
      status: 'draft',
    });
    await app.renderMovementList();

    const p = app.handleSend('m2');
    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'));
    dialog.shadowRoot.getElementById('confirm-btn').click();

    const list = app.appRoot.shadowRoot.querySelector('ll-movement-list');
    await vi.waitFor(() => {
      const cardSend = list.shadowRoot.querySelector('article[data-id="m2"] .send-btn');
      expect(cardSend).toBeTruthy();
      expect(cardSend.disabled).toBe(true);
      expect(cardSend.textContent).toContain('send.sending');
    });

    resolveSend({ status: 'success', remoteTxnId: 'r2' });
    await p;

    const attempts = await db.getAllByIndex('movement_send_attempts', 'movementId', 'm2');
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('success');
  });

  it('already-sent path still shows already-sent modal (not first confirm)', async () => {
    const sendTransactionToHost = vi.fn(async () => ({ status: 'success', remoteTxnId: 'r3' }));
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => true,
      waitForReady: vi.fn(async () => true),
      getActiveOrigin: () => 'https://mybudgetsocial.com',
      sendTransactionToHost,
      getUserProfile: vi.fn(),
      request: vi.fn(async (msg) => {
        if (msg?.type === 'GET_USER_PROFILE') return { profile: { username: '' } };
        return {};
      }),
    });

    const app = new FinancieApp();
    await app.init();

    await db.add('movements', {
      id: 'm3',
      rev: 1,
      txnType: 'income',
      date: '2026-01-03',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Acme',
      notes: '',
      status: 'sent',
    });
    await db.put('movement_remote_map', {
      movementId: 'm3',
      idempotencyKey: 'm3:1',
      remoteTxnId: 'remote_9',
      firstSentAt: Date.now() - 1000,
      lastSentAt: Date.now() - 500,
      sentCount: 1,
    });

    const p = app.handleSend('m3');
    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'));
    expect(dialog.shadowRoot.getElementById('title')?.textContent).toBe('send.alreadySent.title');
    dialog.shadowRoot.getElementById('cancel-btn').click();
    await p;
  });
});

