import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'es',
  t: (key) => {
    if (key === 'send.resendConfirm.phrase') return 'confirmo enviar';
    if (key === 'send.alreadySent.sentAt') return 'Sent on';
    if (key === 'send.alreadySent.remoteId') return 'Remote transaction id';
    return key;
  },
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

describe('Resend UX + sending indicator', () => {
  beforeEach(async () => {
    __resetBridgeForTests();
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
    dialog.style.display = 'none';
  });

  it('shows "Already sent" dialog and does not send on Close', async () => {
    const sendTransactionToHost = vi.fn(async () => ({ status: 'success', remoteTxnId: 'new_remote' }));
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
      date: '2025-01-01',
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
      movementId: 'm1',
      idempotencyKey: 'm1:1',
      remoteTxnId: 'remote_1',
      firstSentAt: Date.now() - 1000,
      lastSentAt: Date.now() - 500,
      sentCount: 1,
    });

    const p = app.handleSend('m1');

    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'));
    expect(dialog.shadowRoot.getElementById('title')?.textContent).toBe('send.alreadySent.title');
    expect(dialog.shadowRoot.getElementById('message')?.textContent).toContain('remote_1');

    dialog.shadowRoot.getElementById('cancel-btn').click();
    await p;

    expect(sendTransactionToHost).not.toHaveBeenCalled();
  });

  it('requires typed phrase to resend and appends existing remoteTxnId to outgoing note', async () => {
    const sendTransactionToHost = vi.fn(async () => ({ status: 'success', remoteTxnId: 'remote_new' }));
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
      date: '2025-01-02',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Acme',
      notes: 'hello',
      status: 'sent',
    });
    await db.put('movement_remote_map', {
      movementId: 'm2',
      idempotencyKey: 'm2:1',
      remoteTxnId: 'remote_old',
      firstSentAt: Date.now() - 1000,
      lastSentAt: Date.now() - 500,
      sentCount: 1,
    });

    const p = app.handleSend('m2');

    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'));
    dialog.shadowRoot.getElementById('confirm-btn').click(); // Resend

    await vi.waitFor(() => expect(dialog.style.display).toBe('flex'));
    expect(dialog.shadowRoot.getElementById('title')?.textContent).toBe('send.resendConfirm.title');
    expect(dialog.shadowRoot.getElementById('phrase-code')?.textContent).toBe('confirmo enviar');

    const input = dialog.shadowRoot.getElementById('input');
    const confirm = dialog.shadowRoot.getElementById('confirm-btn');
    expect(confirm.disabled).toBe(true);

    input.value = 'nope';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(confirm.disabled).toBe(true);

    input.value = 'confirmo enviar';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(confirm.disabled).toBe(false);

    confirm.click();
    await p;

    expect(sendTransactionToHost).toHaveBeenCalledTimes(1);
    const [payload] = sendTransactionToHost.mock.calls[0];
    expect(payload.notes).toContain('\n\nRemoteTxnId: remote_old');

    const updated = await db.get('movements', 'm2');
    expect(updated.notes).toContain('RemoteTxnId: remote_new');
  });

  it('shows per-row "Sending…" state while send promise is pending', async () => {
    vi.spyOn(dialog, 'confirm').mockResolvedValue(true);
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
      id: 'm3',
      rev: 1,
      txnType: 'income',
      date: '2025-01-03',
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

    const p = app.handleSend('m3');

    const list = app.appRoot.shadowRoot.querySelector('ll-movement-list');
    await vi.waitFor(() => {
      const cardSend = list.shadowRoot.querySelector('article[data-id="m3"] .send-btn');
      expect(cardSend).toBeTruthy();
      expect(cardSend.disabled).toBe(true);
      expect(cardSend.textContent).toContain('send.sending');
    });

    resolveSend({ status: 'success', remoteTxnId: 'r3' });
    await p;

    await vi.waitFor(() => {
      const cardSend = list.shadowRoot.querySelector('article[data-id="m3"] .send-btn');
      expect(cardSend.disabled).toBe(false);
      expect(cardSend.textContent).toContain('send');
    });
  });
});
