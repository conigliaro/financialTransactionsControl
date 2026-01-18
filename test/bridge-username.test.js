import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => {
    const map = {
      'user.anonymous': 'Anonymous',
      'user.menu': 'User menu',
      'company.name': 'Company Name',
      'header.subtitle': 'Track expenses in seconds',
      'export.csv': 'Export CSV',
      period: 'Period',
      back: 'Back',
      close: 'Close',
    };
    return map[key] || key;
  },
}));

vi.mock('../host/bridge-client.js', () => ({
  initializeBridge: vi.fn(),
  waitForBridgeReady: vi.fn(),
  isBridgeReady: vi.fn(),
  getUserProfile: vi.fn(),
  sendTransactionToHost: vi.fn(),
}));

import { FinancieApp } from '../financie-app.js';
import * as bridgeClient from '../host/bridge-client.js';

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

describe('Bridge user profile username', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory();
    await resetIndexedDb();
    document.body.innerHTML = '';

    window.innerWidth = 1024;
    window.dispatchEvent(new Event('resize'));

    vi.mocked(bridgeClient.initializeBridge).mockResolvedValue(undefined);
    vi.mocked(bridgeClient.waitForBridgeReady).mockResolvedValue(true);
    vi.mocked(bridgeClient.isBridgeReady).mockReturnValue(true);
  });

  it('shows profile.username in desktop header when bridge returns it', async () => {
    vi.mocked(bridgeClient.getUserProfile).mockResolvedValue({
      profile: { username: 'andres', baseCurrency: 'EUR' },
    });

    const app = new FinancieApp();
    await app.init();
    await new Promise((r) => setTimeout(r, 0));

    const header = app.appRoot.shadowRoot.querySelector('ll-header');
    const nameEl = header.shadowRoot.querySelector('.user-name');
    expect(nameEl?.textContent).toBe('andres');
  });

  it('keeps Anonymous when NOT_AUTHED', async () => {
    vi.mocked(bridgeClient.getUserProfile).mockRejectedValue(
      Object.assign(new Error('not authed'), { code: 'NOT_AUTHED' }),
    );

    const app = new FinancieApp();
    await app.init();
    await new Promise((r) => setTimeout(r, 0));

    const header = app.appRoot.shadowRoot.querySelector('ll-header');
    const nameEl = header.shadowRoot.querySelector('.user-name');
    expect(nameEl?.textContent).toBe('Anonymous');
  });
});

