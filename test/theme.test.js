import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { db } from '../db/indexeddb.js';
import { FinancieApp } from '../financie-app.js';

// Mock IndexedDB
global.indexedDB = new IDBFactory();

// Mock dependencies of FinancieApp
vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => key,
}));

describe('Theme Management', () => {
  let app;

  beforeEach(async () => {
    // Reset DOM
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    
    // Clear DB
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      await new Promise(res => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = res;
      });
    }

    app = new FinancieApp();
    await app.init();
  });

  it('should default to light theme', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(app.currentTheme).toBe('light');
  });

  it('should toggle theme to dark and persist it', async () => {
    app.toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(app.currentTheme).toBe('dark');

    const themeMeta = await db.get('meta', 'theme');
    expect(themeMeta.value).toBe('dark');
  });

  it('should load the saved theme on initialization', async () => {
    // First, set and persist the dark theme
    app.setTheme('dark');
    
    // Create a new app instance to simulate a reload
    const newApp = new FinancieApp();
    await newApp.init();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(newApp.currentTheme).toBe('dark');
  });

  it('should toggle back to light theme', () => {
    app.setTheme('dark');
    app.toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(app.currentTheme).toBe('light');
  });
});
