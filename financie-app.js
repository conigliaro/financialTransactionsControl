// financie-app.js

import { db } from './db/indexeddb.js';
import { loadTranslations, setLanguage as i18nSetLanguage, t } from './i18n/loader.js';
import './components/ll-app.js';
import './components/ll-header.js';
import './components/ll-movement-list.js';
import './components/ll-movement-form.js';
import './components/ll-export-dialog.js';
import './components/ll-vendors-crud.js';
import './components/ll-expense-types-crud.js';
import './components/ll-currencies-crud.js';
import './components/ll-company-settings.js';
import { showToast } from './components/ui-toast.js';
import { dialog } from './components/ui-dialog.js';
import { uuidv4 } from './utils/uuid.js';
import { getUserProfile, initializeBridge as initBridge, isBridgeReady, sendTransactionToHost, waitForBridgeReady } from './host/bridge-client.js';

export class FinancieApp {
  constructor() {
    this.appRoot = document.createElement('ll-app');
    document.body.appendChild(this.appRoot);
    this.movementList = this.appRoot.shadowRoot.querySelector('ll-movement-list');
    this.header = this.appRoot.shadowRoot.querySelector('ll-header');
    this.currentTheme = 'light';
    this.currentView = 'main';
    this.currentCurrencyCode = 'EUR';
    this._sendingMovementIds = new Set();
    this._bridgeProfileLoaded = false;
  }

  async init() {
    try {
      await initBridge();
    } catch {
      // Bridge is optional in standalone mode.
    }
    await db.open();
    await this.loadLanguage();
    await this.loadTheme();
    await this.loadDefaultCurrency();
    await this.loadCompany();
    this.addEventListeners();
    this.movementList?.setCurrency?.({ code: this.currentCurrencyCode });
    await this.renderMovementList();
    this.populateMonthYearSelectors();
    await this.populateCatalogOptions();
    this.setView('main');

    await this._showFirstRunIfNeeded();
    void this._loadBridgeUserProfileOnce();
  }

  async _showFirstRunIfNeeded() {
    try {
      const env = globalThis?.process?.env;
      const isTest = env?.NODE_ENV === 'test' || env?.VITEST === 'true';
      const enabled =
        Boolean(globalThis.__ENABLE_FIRST_RUN_DIALOG_TESTS) ||
        Boolean(globalThis?.window?.__ENABLE_FIRST_RUN_DIALOG_TESTS);
      if (isTest && !enabled) return;
    } catch {
      // no-op
    }

    try {
      const dismissed = await db.get('meta', 'firstRunDismissed');
      if (dismissed?.value === true) return;
    } catch {
      // ignore; fall through to show
    }

    const res = await dialog.firstRun({
      title: t('firstRun.title'),
      bodyLines: [t('firstRun.body.1'), t('firstRun.body.2'), t('firstRun.body.3')],
      ctaLabel: t('firstRun.cta'),
      dontShowAgainLabel: t('firstRun.dontShowAgain'),
      defaultDontShowAgain: true,
    });

    if (res?.confirmed && res?.dontShowAgain) {
      try {
        await db.put('meta', { key: 'firstRunDismissed', value: true });
      } catch {
        // ignore
      }
    }
  }

  async _loadBridgeUserProfileOnce() {
    if (this._bridgeProfileLoaded) return;
    this._bridgeProfileLoaded = true;

    const ready = await waitForBridgeReady({ timeoutMs: 8000 });
    if (!ready || !isBridgeReady()) return;

    try {
      const res = await getUserProfile({ timeoutMs: 8000 });
      const username = res?.profile?.username;
      if (typeof username !== 'string' || !username.trim()) return;
      const name = username.trim();
      this.header?.setUser?.({ name });
      window.dispatchEvent(new CustomEvent('bridge:user-profile', { detail: { username: name } }));
    } catch {
      // NOT_AUTHED / MISSING_PERMISSION / UNKNOWN / TIMEOUT: keep anonymous, no spam.
    }
  }

  addEventListeners() {
    const headerEl = this.header.shadowRoot;
    const movementForm = this.appRoot.shadowRoot.querySelector('ll-movement-form');
    const exportDialog = this.appRoot.shadowRoot.querySelector('ll-export-dialog');
    const movementDetails = this.appRoot.shadowRoot.querySelector('ll-movement-details');

    this.header.addEventListener('ll-theme-toggle', () => this.toggleTheme());
    this.header.addEventListener('ll-theme-set', (e) => {
      const theme = e.detail?.theme;
      if (theme === 'light' || theme === 'dark') this.setTheme(theme);
    });
    this.header.addEventListener('ll-language-change', (e) => this.setLanguage(e.detail?.lang));
    this.header.addEventListener('ll-export', () => exportDialog.show());
    this.header.addEventListener('ll-nav', (e) => this.setView(e.detail?.view));
    this.appRoot.addEventListener('ll-nav', (e) => this.setView(e.detail?.view));
    this.appRoot.addEventListener('ll-company-updated', (e) => {
      const name = e.detail?.name;
      const subtitle = e.detail?.subtitle;
      this.header.setCompany?.({ name, subtitle });
    });
    
    this.movementList.shadowRoot.addEventListener('click', async (e) => {
      if (e.target.closest('#add-first-movement-btn')) {
        movementForm.show();
      }

      const row = e.target.closest('[data-id]');
      const movementId = row?.dataset?.id;
      if (!movementId) return;

      if (e.target.closest('.edit-btn')) {
        await this.handleEdit(movementId);
      }
      if (e.target.closest('.delete-btn')) {
        await this.handleDelete(movementId);
      }
      if (e.target.closest('.send-btn')) {
        await this.handleSend(movementId);
      }
      if (e.target.closest('.details-btn')) {
        movementDetails?.show?.({ movementId });
      }
    });

    const fab = this.appRoot.shadowRoot.querySelector('#fab-add-movement');
    fab?.addEventListener('click', () => movementForm.show());

    movementForm.addEventListener('ll-movement-cancel', () => {
      movementForm.hide();
    });

    movementForm.addEventListener('ll-movement-save', async (e) => {
      const form = e.detail?.form || movementForm.shadowRoot.querySelector('form');
      if (!form) return;
      movementForm.setSaving?.(true);
      try {
        await this.saveMovement(form, movementForm.editingMovementId, movementForm.editingMovementStatus);
        movementForm.hide();
      } catch (error) {
        try {
          const env = globalThis?.process?.env;
          const isTest = env?.NODE_ENV === 'test' || env?.VITEST === 'true';
          if (!isTest) console.error('[save] Movement save failed', error);
        } catch {
          // no-op
        }
        const message = error?.message ? String(error.message) : String(error);
        const stack = error?.stack ? String(error.stack) : '';
        const details = stack ? `${message}\n\n${stack}` : message;
        await dialog.alert({
          title: t('save.error.title'),
          message: t('save.error.message'),
          detailsLabel: t('save.error.details'),
          details,
          closeLabel: t('close'),
          copyLabel: t('copy.details'),
        });
      } finally {
        movementForm.setSaving?.(false);
      }
    });

    movementDetails?.addEventListener('ll-movement-details-retry', async (e) => {
      const movementId = e.detail?.movementId;
      if (!movementId) return;
      await this.handleSend(String(movementId));
      movementDetails.refresh?.();
    });

    movementForm.addEventListener('ll-catalog-upsert', async (e) => {
      const kind = e.detail?.kind;
      const value = e.detail?.value;
      if (!value) return;
      if (kind === 'vendor') await this.updateCatalogs(value, null);
      if (kind === 'expenseType') await this.updateCatalogs(null, value);
    });

    this.appRoot.addEventListener('ll-catalog-changed', () => this.populateCatalogOptions());
    this.appRoot.addEventListener('ll-currency-changed', async () => {
      await this.loadDefaultCurrency();
      this.movementList?.setCurrency?.({ code: this.currentCurrencyCode });
      await this.renderMovementList();
    });

    exportDialog.shadowRoot.querySelector('#close-btn').addEventListener('click', () => {
        exportDialog.hide();
    });
    exportDialog.shadowRoot.querySelector('#export-csv-btn').addEventListener('click', () => {
        this.exportCSV();
        exportDialog.hide();
    });
  }

  setView(view) {
    const next = view || 'main';
    this.currentView = next;
    this.appRoot.setView(next);
    this.header.setView(next);
  }

  async saveMovement(form, editingMovementId = null, editingMovementStatus = null) {
    const formData = new FormData(form);
    const rawTxnType = String(formData.get('txnType') || '').trim();
    const txnType = rawTxnType === 'income' || rawTxnType === 'expense' ? rawTxnType : 'expense';
    const docValue = parseFloat(formData.get('docValue')) || 0;
    const interest = parseFloat(formData.get('interest')) || 0;
    const discount = parseFloat(formData.get('discount')) || 0;

    const paidValueRaw = formData.get('paidValue');
    const paidValueProvided = paidValueRaw != null && String(paidValueRaw).trim() !== '';
    let paidValue = paidValueProvided ? parseFloat(paidValueRaw) || 0 : 0;

    if (!paidValueProvided) {
        paidValue = docValue + interest - discount;
    }

    const isEditing = Boolean(editingMovementId);
    const now = Date.now();

    let before = null;
    let rev = 1;
    let status = 'draft';
    let id = uuidv4();

    if (isEditing) {
      id = String(editingMovementId);
      before = await db.get('movements', id);
      const prevRev = Number(before?.rev);
      rev = Number.isInteger(prevRev) && prevRev >= 1 ? prevRev + 1 : 2;
      status = String(before?.status || editingMovementStatus || 'draft');
    }

    const movement = {
      id,
      rev,
      txnType,
      date: formData.get('date'),
      docValue,
      interest,
      discount,
      paidValue,
      expenseType: formData.get('expenseType'),
      vendor: formData.get('vendor'),
      notes: formData.get('notes'),
      status: isEditing ? status : 'draft',
    };

    if (isEditing) await db.put('movements', movement);
    else await db.add('movements', movement);

    await this._logMovementChange({
      movementId: movement.id,
      action: isEditing ? 'update' : 'create',
      before,
      after: movement,
      source: isEditing ? 'user_edit' : 'user_create',
      createdAt: now,
    });

    showToast(t('movement.saved.success'), { variant: 'success' });
    await this.updateCatalogs(movement.vendor, movement.expenseType);
    this.renderMovementList();
    form.reset();
  }
  
  async handleEdit(movementId) {
    const movement = await db.get('movements', movementId);
    if (!movement) return;
    const movementForm = this.appRoot.shadowRoot.querySelector('ll-movement-form');
    movementForm.edit(movement);
  }

  async handleDelete(movementId) {
      const confirmed = await dialog.confirm({
          title: t('confirm.delete.title'),
          message: t('confirm.delete.body'),
          confirmLabel: t('delete'),
          cancelLabel: t('cancel'),
          variant: 'danger',
      });
      if(confirmed) {
        const before = await db.get('movements', movementId);
        await this._logMovementChange({
          movementId: String(movementId),
          action: 'delete',
          before,
          after: null,
          source: 'user_delete',
          createdAt: Date.now(),
        });
        await db.delete('movements', movementId);
        showToast(t('movement.deleted.success'), { variant: 'success' });
        await this.renderMovementList();
      }
  }

  _idempotencyKeyFor(movement) {
    const id = String(movement?.id || '');
    const rev = Number(movement?.rev);
    const safeRev = Number.isInteger(rev) && rev >= 1 ? rev : 1;
    return `${id}:${safeRev}`;
  }

  _buildSendPayload(movement) {
    return {
      movementId: String(movement?.id || ''),
      txnType: movement?.txnType === 'income' ? 'income' : 'expense',
      date: String(movement?.date || ''),
      paidValue: Number(movement?.paidValue) || 0,
      docValue: Number(movement?.docValue) || 0,
      interest: Number(movement?.interest) || 0,
      discount: Number(movement?.discount) || 0,
      categoryId: movement?.categoryId,
      vendor: String(movement?.vendor || ''),
      expenseType: String(movement?.expenseType || ''),
      notes: String(movement?.notes || ''),
      currencyCode: String(this.currentCurrencyCode || 'EUR'),
      rev: Number(movement?.rev) || 1,
    };
  }

  _validateMovementForSend(movement) {
    if (!movement) return t('send.validation.missing_movement');
    if (!movement.date) return t('send.validation.missing_date');
    if (!Number.isFinite(Number(movement.paidValue))) return t('send.validation.missing_amount');
    return null;
  }

  async handleSend(movementId) {
    const id = String(movementId || '');
    if (!id) return;
    if (this._sendingMovementIds.has(id)) {
      showToast(t('send.in_progress'), { variant: 'warning' });
      return;
    }

    this._sendingMovementIds.add(id);
    try {
      const movement = await db.get('movements', id);
      const error = this._validateMovementForSend(movement);
      if (error) {
        showToast(error, { variant: 'warning' });
        return;
      }

      const existingMap = await db.get('movement_remote_map', id);
      if (existingMap?.remoteTxnId) {
        showToast(t('send.already_sent'), { variant: 'info' });
        return;
      }

      const existingAttempts = await db.getAllByIndex('movement_send_attempts', 'movementId', id);
      const hasPending = Array.isArray(existingAttempts) && existingAttempts.some((a) => a?.status === 'pending');
      if (hasPending) {
        showToast(t('send.in_progress'), { variant: 'warning' });
        return;
      }

      const idempotencyKey = this._idempotencyKeyFor(movement);
      const payload = this._buildSendPayload(movement);

      const attemptId = uuidv4();
      const createdAt = Date.now();
      const start = (globalThis?.performance?.now?.() ?? Date.now());

      if (!isBridgeReady()) {
        await db.add('movement_send_attempts', {
          attemptId,
          movementId: id,
          createdAt,
          status: 'failed',
          idempotencyKey,
          requestPayload: payload,
          responsePayload: null,
          errorCode: 'HOST_NOT_CONNECTED',
          errorMessage: 'HOST_NOT_CONNECTED',
          durationMs: 0,
          remoteTxnId: null,
        });
        showToast(t('send.host_not_connected'), { variant: 'warning' });
        return;
      }

      await db.add('movement_send_attempts', {
        attemptId,
        movementId: id,
        createdAt,
        status: 'pending',
        idempotencyKey,
        requestPayload: payload,
        responsePayload: null,
        errorCode: null,
        errorMessage: null,
        durationMs: null,
        remoteTxnId: null,
      });

      let response;
      try {
        response = await sendTransactionToHost(payload, idempotencyKey, { timeoutMs: 15_000 });
      } catch (err) {
        const durationMs = Math.max(0, (globalThis?.performance?.now?.() ?? Date.now()) - start);
        const extracted = this._extractBridgeSendError(err);
        const responsePayload =
          extracted?.responsePayload ??
          err?.responsePayload ??
          (err?.raw ? { error: err.raw } : null) ??
          null;
        await db.put('movement_send_attempts', {
          attemptId,
          movementId: id,
          createdAt,
          status: 'failed',
          idempotencyKey,
          requestPayload: payload,
          responsePayload,
          errorCode: String(extracted?.code || err?.code || 'UNKNOWN'),
          errorMessage: String(extracted?.message || err?.message || err),
          durationMs,
          remoteTxnId: null,
        });
        void this._showSendErrorDialog(extracted);
        return;
      }

      const durationMs = Math.max(0, (globalThis?.performance?.now?.() ?? Date.now()) - start);
      const status = String(response?.status || '').toLowerCase();
      const remoteTxnId = response?.remoteTxnId;

      if (status !== 'success' || typeof remoteTxnId !== 'string' || !remoteTxnId.trim()) {
        await db.put('movement_send_attempts', {
          attemptId,
          movementId: id,
          createdAt,
          status: 'failed',
          idempotencyKey,
          requestPayload: payload,
          responsePayload: response,
          errorCode: 'INVALID_ACK',
          errorMessage: 'Invalid host confirmation',
          durationMs,
          remoteTxnId: null,
        });
        void this._showSendErrorDialog(this._extractBridgeSendError({ responsePayload: response }));
        return;
      }

      await db.put('movement_send_attempts', {
        attemptId,
        movementId: id,
        createdAt,
        status: 'success',
        idempotencyKey,
        requestPayload: payload,
        responsePayload: response,
        errorCode: null,
        errorMessage: null,
        durationMs,
        remoteTxnId: remoteTxnId.trim(),
      });

      const prevSentCount = Number(existingMap?.sentCount);
      const nextCount = Number.isFinite(prevSentCount) ? prevSentCount + 1 : 1;
      const firstSentAt = existingMap?.firstSentAt || createdAt;
      await db.put('movement_remote_map', {
        movementId: id,
        idempotencyKey,
        remoteTxnId: remoteTxnId.trim(),
        firstSentAt,
        lastSentAt: createdAt,
        sentCount: nextCount,
      });

      const before = movement;
      const after = { ...movement, status: 'sent' };
      await db.put('movements', after);
      await this._logMovementChange({
        movementId: id,
        action: 'update',
        before,
        after,
        source: 'send_status_update',
        createdAt,
      });

      showToast(t('send.success'), { variant: 'success' });
    } finally {
      this._sendingMovementIds.delete(id);
    }
  }

  _extractBridgeSendError(err) {
    const responsePayload = err?.responsePayload ?? null;
    const raw = err?.raw ?? responsePayload?.error ?? null;
    const code =
      (typeof raw?.code === 'string' && raw.code) ||
      (typeof responsePayload?.error?.code === 'string' && responsePayload.error.code) ||
      (typeof err?.code === 'string' && err.code) ||
      null;
    const message =
      (typeof raw?.message === 'string' && raw.message) ||
      (typeof responsePayload?.error?.message === 'string' && responsePayload.error.message) ||
      (typeof err?.message === 'string' && err.message) ||
      null;
    return { code, message, responsePayload };
  }

  _friendlySendErrorMessage(code) {
    if (code === 'CATEGORY_NOT_FOUND') return t('send.error.category_not_found');
    return t('send.error.generic');
  }

  async _showSendErrorDialog(extracted) {
    const code = extracted?.code ? String(extracted.code) : '';
    const hostMessage = extracted?.message ? String(extracted.message) : '';

    const friendly = this._friendlySendErrorMessage(code);
    const message = hostMessage ? `${friendly} — ${hostMessage}` : friendly;

    const details = [
      `${t('send.error.codeLabel')}: ${code || 'UNKNOWN'}`,
      hostMessage ? `${t('send.error.messageLabel')}: ${hostMessage}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await dialog.alert({
      title: t('send.error.title'),
      message,
      detailsLabel: t('send.error.details'),
      details,
      closeLabel: t('close'),
      copyLabel: t('copy.details'),
    });
  }

  _diffMovement(before, after) {
    const out = [];
    const fields = [
      'txnType',
      'date',
      'docValue',
      'interest',
      'discount',
      'paidValue',
      'expenseType',
      'vendor',
      'notes',
      'status',
      'rev',
    ];
    for (const field of fields) {
      const from = before ? before[field] : undefined;
      const to = after ? after[field] : undefined;
      if (from === to) continue;
      out.push({ field, from, to });
    }
    return out;
  }

  async _logMovementChange({ movementId, action, before, after, source, createdAt }) {
    const changeId = uuidv4();
    const ts = Number(createdAt || Date.now());
    const diff = action === 'update' ? this._diffMovement(before, after) : [];
    await db.add('movement_change_log', {
      changeId,
      movementId: String(movementId),
      createdAt: ts,
      action,
      before,
      after,
      diff,
      source: source || null,
    });
  }

  async updateCatalogs(vendor, expenseType) {
    const normalize = (s) => String(s || '').trim().replace(/\s+/g, ' ');
    const normKey = (s) => normalize(s).toLowerCase();

    const vendorName = normalize(vendor);
    if (vendorName) {
      const vendors = await db.getAll('catalog_vendors');
      const existing = vendors.find((v) => normKey(v.normalizedName || v.name) === normKey(vendorName));
      if (!existing) {
        await db.add('catalog_vendors', { name: vendorName, normalizedName: normKey(vendorName), createdAt: new Date() });
      }
    }

    const expenseTypeName = normalize(expenseType);
    if (expenseTypeName) {
      const expenseTypes = await db.getAll('catalog_expense_types');
      const existing = expenseTypes.find((et) => normKey(et.normalizedName || et.name) === normKey(expenseTypeName));
      if (!existing) {
        await db.add('catalog_expense_types', { name: expenseTypeName, normalizedName: normKey(expenseTypeName), createdAt: new Date() });
      }
    }

    await this.populateCatalogOptions();
  }
  
  async populateCatalogOptions() {
      const movementForm = this.appRoot.shadowRoot.querySelector('ll-movement-form');
      const vendors = await db.getAll('catalog_vendors');
      const expenseTypes = await db.getAll('catalog_expense_types');

      movementForm.setCatalogOptions({
        vendors: (vendors || []).map((v) => ({ id: v.id, name: v.name, normalizedName: v.normalizedName })).filter((v) => v.name),
        expenseTypes: (expenseTypes || []).map((et) => ({ id: et.id, name: et.name, normalizedName: et.normalizedName })).filter((et) => et.name),
      });
  }

  async renderMovementList() {
    const movements = await db.getAll('movements');
    this.movementList.setMovements(movements.sort((a,b) => new Date(b.date) - new Date(a.date)));
  }

  populateMonthYearSelectors() {
    const currentYear = new Date().getFullYear();
    
    const months = [
      { value: 1, label: t('month.1') },
      { value: 2, label: t('month.2') },
      { value: 3, label: t('month.3') },
      { value: 4, label: t('month.4') },
      { value: 5, label: t('month.5') },
      { value: 6, label: t('month.6') },
      { value: 7, label: t('month.7') },
      { value: 8, label: t('month.8') },
      { value: 9, label: t('month.9') },
      { value: 10, label: t('month.10') },
      { value: 11, label: t('month.11') },
      { value: 12, label: t('month.12') },
    ];
    
    const years = [];
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
        years.push({ value: i, label: String(i) });
    }
    
    const month = new Date().getMonth() + 1;
    const year = currentYear;
    this.header.setPeriodOptions({ months, years, month, year });
  }

  async loadTheme() {
    const themeMeta = await db.get('meta', 'theme');
    const theme = themeMeta ? themeMeta.value : 'light';
    this.setTheme(theme);
  }

  async loadDefaultCurrency() {
    const meta = await db.get('meta', 'defaultCurrencyCode');
    const code = meta?.value ? String(meta.value) : 'EUR';
    this.currentCurrencyCode = code;
    if (!meta?.value) {
      await db.put('meta', { key: 'defaultCurrencyCode', value: code });
    }
  }

  async loadCompany() {
    const [nameMeta, subtitleMeta] = await Promise.all([
      db.get('meta', 'companyName'),
      db.get('meta', 'companySubtitle'),
    ]);
    const name = nameMeta?.value ? String(nameMeta.value) : '';
    const subtitle = subtitleMeta?.value ? String(subtitleMeta.value) : '';
    this.header.setCompany?.({ name, subtitle });
  }

  async loadLanguage() {
    const languageMeta = await db.get('meta', 'language');
    await loadTranslations(languageMeta?.value);
  }

  async setLanguage(lang) {
    if (!lang) return;
    const normalized = String(lang);
    await db.put('meta', { key: 'language', value: normalized });
    await i18nSetLanguage(normalized);
    this.populateMonthYearSelectors();
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    this.currentTheme = theme;
    this.header.updateThemeIcon(theme);
    db.put('meta', { key: 'theme', value: theme });
  }

  toggleTheme() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
  }
  
  async exportCSV() {
    const movements = await db.getAll('movements');
    const header = "DATA;VALOR DOC.;JUROS/MULTAS;DESCONTOS;VALOR PAGO;TIPO DA DESPESA;FORNECEDOR;TYPE\n";
    const rows = movements.map(m => {
        const txnType = m?.txnType === 'income' ? 'income' : 'expense';
        return `${m.date};${m.docValue};${m.interest};${m.discount};${m.paidValue};${m.expenseType};${m.vendor};${txnType}`;
    }).join('\n');
    
    const csvContent = "data:text/csv;charset=utf-8," + header + rows;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "movements.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
