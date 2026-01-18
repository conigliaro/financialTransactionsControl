const DB_NAME = 'ledgerlite';
const DB_VERSION = 4;

class IndexedDBWrapper {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const tx = event.target.transaction;
        const oldVersion = Number(event.oldVersion || 0);
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('movements')) {
          const movementsStore = db.createObjectStore('movements', { keyPath: 'id' });
          movementsStore.createIndex('date', 'date', { unique: false });
          movementsStore.createIndex('vendor', 'vendor', { unique: false });
          movementsStore.createIndex('expenseType', 'expenseType', { unique: false });
          movementsStore.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('catalog_vendors')) {
          db.createObjectStore('catalog_vendors', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('catalog_expense_types')) {
          db.createObjectStore('catalog_expense_types', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('catalog_currencies')) {
          db.createObjectStore('catalog_currencies', { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains('outbox_ops')) {
          db.createObjectStore('outbox_ops', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('mappings')) {
          db.createObjectStore('mappings', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('movement_remote_map')) {
          db.createObjectStore('movement_remote_map', { keyPath: 'movementId' });
        }
        if (!db.objectStoreNames.contains('movement_send_attempts')) {
          const store = db.createObjectStore('movement_send_attempts', { keyPath: 'attemptId' });
          store.createIndex('movementId', 'movementId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('movement_change_log')) {
          const store = db.createObjectStore('movement_change_log', { keyPath: 'changeId' });
          store.createIndex('movementId', 'movementId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        try {
          const currenciesStore = tx.objectStore('catalog_currencies');
          const seed = (code, name, symbol) => {
            const getReq = currenciesStore.get(code);
            getReq.onsuccess = () => {
              if (getReq.result) return;
              currenciesStore.put({ code, name, symbol, createdAt: new Date() });
            };
          };
          seed('USD', 'US Dollar', '$');
          seed('EUR', 'Euro', '€');
          seed('BRL', 'Brazilian Real', 'R$');

          const metaStore = tx.objectStore('meta');
          const metaReq = metaStore.get('defaultCurrencyCode');
          metaReq.onsuccess = () => {
            if (metaReq.result?.value) return;
            metaStore.put({ key: 'defaultCurrencyCode', value: 'EUR' });
          };
        } catch {
          // no-op
        }

        // v3 migration: ensure txnType exists on existing movements (default: expense)
        // v4 migration: ensure rev exists on existing movements (default: 1)
        if (oldVersion > 0 && oldVersion < 4) {
          try {
            const allowed = new Set(['expense', 'income']);
            const movementsStore = tx.objectStore('movements');
            const cursorReq = movementsStore.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              const value = cursor.value;
              const next = { ...value };
              const txnType = next?.txnType;
              if (!allowed.has(txnType)) next.txnType = 'expense';

              const rev = Number(next?.rev);
              if (!Number.isInteger(rev) || rev < 1) next.rev = 1;

              cursor.update(next);
              cursor.continue();
            };
          } catch {
            // no-op
          }
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        resolve();
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getAllByIndex(storeName, indexName, query) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(query);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async add(storeName, item) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(item);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async put(storeName, item) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(item);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }
}

export const db = new IndexedDBWrapper();
