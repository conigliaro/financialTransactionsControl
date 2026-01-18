import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => key,
}));

vi.mock('../utils/xlsx-export.js', () => ({
  generateXlsxBuffer: vi.fn(async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04])), // PK..
}));

vi.mock('../db/indexeddb.js', () => ({
  db: {
    open: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    getAll: vi.fn(async () => []),
    getAllByIndex: vi.fn(async () => []),
    add: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../host/bridge-client.js', () => ({
  initializeBridge: vi.fn(),
  isBridgeReady: () => false,
  waitForBridgeReady: vi.fn(async () => false),
  sendTransactionToHost: vi.fn(),
  getUserProfile: vi.fn(),
  __resetBridgeForTests: vi.fn(),
  __setBridgeForTests: vi.fn(),
}));

import { FinancieApp } from '../financie-app.js';
import { generateXlsxBuffer } from '../utils/xlsx-export.js';
import { db } from '../db/indexeddb.js';

describe('Export XLSX flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('exportXlsx() generates and triggers download', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    const click = vi.fn();
    const link = document.createElement('a');
    link.click = click;

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, ...rest) => {
      if (String(tagName).toLowerCase() === 'a') return link;
      return origCreateElement(tagName, ...rest);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    db.getAll.mockResolvedValueOnce([{ id: 'm1', date: '2026-01-01' }]);

    const exportDialog = {
      setBusy: vi.fn(),
      hide: vi.fn(),
    };

    const app = {
      exportDialog,
      companyName: 'ACME LLC',
      currentMonth: 1,
      currentYear: 2026,
      currentCurrencyCode: 'EUR',
    };

    await FinancieApp.prototype.exportXlsx.call(app);

    expect(generateXlsxBuffer).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });
});
