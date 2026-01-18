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

describe('Send to host (idempotency + attempts + change log)', () => {
  beforeEach(async () => {
    __resetBridgeForTests();
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';
  });

  it('stores attempt, mapping, and status change on send success', async () => {
    const sendTransactionToHost = vi.fn(async () => ({ status: 'success', remoteTxnId: 'r1' }));
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => true,
      getActiveOrigin: () => 'https://mybudgetsocial.com',
      sendTransactionToHost,
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
      status: 'draft',
    });

    await app.handleSend('m1');

    const map = await db.get('movement_remote_map', 'm1');
    expect(map.remoteTxnId).toBe('r1');
    expect(map.idempotencyKey).toBe('m1:1');

    const updated = await db.get('movements', 'm1');
    expect(updated.status).toBe('sent');
    expect(updated.rev).toBe(1);

    const attempts = await db.getAllByIndex('movement_send_attempts', 'movementId', 'm1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('success');
    expect(attempts[0].remoteTxnId).toBe('r1');
    expect(attempts[0].idempotencyKey).toBe('m1:1');

    const changes = await db.getAllByIndex('movement_change_log', 'movementId', 'm1');
    expect(changes.some((c) => c?.source === 'send_status_update')).toBe(true);
  });

  it('stores failed attempt and allows retry with same idempotencyKey for same rev', async () => {
    const sendTransactionToHost = vi.fn();
    sendTransactionToHost.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'TIMEOUT' }));
    sendTransactionToHost.mockResolvedValueOnce({ status: 'success', remoteTxnId: 'r2' });
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => true,
      getActiveOrigin: () => 'https://mybudgetsocial.com',
      sendTransactionToHost,
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
      notes: '',
      status: 'draft',
    });

    await app.handleSend('m2');
    await app.handleSend('m2');

    const attempts = await db.getAllByIndex('movement_send_attempts', 'movementId', 'm2');
    expect(attempts).toHaveLength(2);
    expect(attempts[0].idempotencyKey).toBe('m2:1');
    expect(attempts[1].idempotencyKey).toBe('m2:1');
    expect(attempts.some((a) => a.status === 'failed')).toBe(true);
    expect(attempts.some((a) => a.status === 'success')).toBe(true);

    const map = await db.get('movement_remote_map', 'm2');
    expect(map.remoteTxnId).toBe('r2');
  });

  it('increments rev on edit and changes idempotencyKey', async () => {
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => false,
      getActiveOrigin: () => null,
      sendTransactionToHost: vi.fn(),
    });
    const app = new FinancieApp();
    await app.init();

    const makeForm = (fields) => {
      const form = document.createElement('form');
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      return form;
    };

    const createForm = makeForm({
      txnType: 'income',
      date: '2025-01-03',
      docValue: '1.00',
      interest: '0.00',
      discount: '0.00',
      paidValue: '1.00',
      expenseType: 'Food',
      vendor: 'A',
      notes: '',
    });

    await app.saveMovement(createForm);
    const [m] = await db.getAll('movements');
    expect(m.rev).toBe(1);

    const editForm = makeForm({
      txnType: 'income',
      date: '2025-01-03',
      docValue: '1.00',
      interest: '0.00',
      discount: '0.00',
      paidValue: '1.00',
      expenseType: 'Food',
      vendor: 'B',
      notes: '',
    });

    await app.saveMovement(editForm, m.id, m.status);
    const updated = await db.get('movements', m.id);
    expect(updated.rev).toBe(2);
    expect(app._idempotencyKeyFor(updated)).toBe(`${updated.id}:2`);
  });

  it('renders send/change history in movement details', async () => {
    __setBridgeForTests({
      initializeBridge: vi.fn(),
      destroy: vi.fn(),
      isReady: () => false,
      getActiveOrigin: () => null,
      sendTransactionToHost: vi.fn(),
    });
    const app = new FinancieApp();
    await app.init();

    await db.add('movements', {
      id: 'm3',
      rev: 1,
      txnType: 'income',
      date: '2025-02-01',
      docValue: 10,
      interest: 0,
      discount: 0,
      paidValue: 10,
      expenseType: 'Food',
      vendor: 'Acme',
      notes: '',
      status: 'draft',
    });
    await db.put('movement_remote_map', {
      movementId: 'm3',
      idempotencyKey: 'm3:1',
      remoteTxnId: 'remote_9',
      firstSentAt: Date.now(),
      lastSentAt: Date.now(),
      sentCount: 1,
    });
    await db.add('movement_send_attempts', {
      attemptId: 'a1',
      movementId: 'm3',
      createdAt: Date.now(),
      status: 'success',
      idempotencyKey: 'm3:1',
      requestPayload: { ok: true },
      responsePayload: { status: 'success', remoteTxnId: 'remote_9' },
      errorCode: null,
      errorMessage: null,
      durationMs: 12,
      remoteTxnId: 'remote_9',
    });
    await db.add('movement_change_log', {
      changeId: 'c1',
      movementId: 'm3',
      createdAt: Date.now(),
      action: 'create',
      before: null,
      after: { id: 'm3' },
      diff: [],
      source: 'user_create',
    });

    const details = app.appRoot.shadowRoot.querySelector('ll-movement-details');
    await details.show({ movementId: 'm3' });

    expect(details.style.display).toBe('flex');
    expect(details.shadowRoot.textContent).toContain('movement.details.title');
    expect(details.shadowRoot.textContent).toContain('remote_9');

    details.hide();
  });
});
