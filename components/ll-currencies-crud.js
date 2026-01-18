import { t } from '../i18n/loader.js';
import { db } from '../db/indexeddb.js';
import { showToast } from './ui-toast.js';
import { dialog } from './ui-dialog.js';
import { sharedStylesTag } from './shared-styles.js';

function normalizeDisplay(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeCode(value) {
  return normalizeDisplay(value).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class LlCurrenciesCrud extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._editingCode = null;
    this._defaultCode = 'EUR';
    this._onI18nUpdated = () => this.render();
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.render();
    this.shadowRoot.addEventListener('click', (e) => this._onClick(e));
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
  }

  async refresh() {
    const [items, meta] = await Promise.all([
      db.getAll('catalog_currencies'),
      db.get('meta', 'defaultCurrencyCode'),
    ]);
    this._defaultCode = meta?.value || 'EUR';
    this._items = (items || []).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { sensitivity: 'base' }));
    this.render();
  }

  render() {
    const canDelete = this._items.length > 1;
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <section class="crud" aria-label="${t('currencies.title')}">
        <div class="crud-header">
          <h2 class="crud-title">${t('currencies.title')}</h2>
          <p class="crud-subtitle">${t('currencies.subtitle')}</p>
        </div>

        <div class="crud-add crud-add--currencies">
          <label class="visually-hidden" for="currency-code">${t('currencies.code')}</label>
          <input id="currency-code" type="text" placeholder="${t('currencies.code')}" autocomplete="off" inputmode="text" />
          <label class="visually-hidden" for="currency-symbol">${t('currencies.symbol')}</label>
          <input id="currency-symbol" type="text" placeholder="${t('currencies.symbol')}" autocomplete="off" inputmode="text" />
          <label class="visually-hidden" for="currency-name">${t('currencies.name')}</label>
          <input id="currency-name" type="text" placeholder="${t('currencies.name')}" autocomplete="off" inputmode="text" />
          <button class="btn primary" id="currency-add-btn" type="button">${t('currencies.add')}</button>
        </div>

        <div class="crud-list card" role="list">
          ${this._items.length === 0 ? `<div class="crud-empty">${t('no.items.yet')}</div>` : ''}
          ${this._items.map((it) => this._renderRow(it, { canDelete })).join('')}
        </div>
      </section>
    `;
  }

  _renderRow(it, { canDelete }) {
    const code = String(it.code || '');
    const isEditing = this._editingCode === code;
    const isDefault = code === String(this._defaultCode || '');
    const name = String(it.name || code);
    const symbol = String(it.symbol || '');

    if (!isEditing) {
      const safeCode = escapeHtml(code);
      const safeName = escapeHtml(name);
      const safeSymbol = escapeHtml(symbol);
      return `
        <div class="crud-row" role="listitem" data-code="${code}">
          <div class="crud-name currency-row">
            <div><strong>${safeCode}</strong> ${symbol ? `<span class="muted">(${safeSymbol})</span>` : ''}</div>
            <div class="muted">${safeName}</div>
          </div>
          <div class="crud-actions">
            ${
              isDefault
                ? `<span class="chip" aria-label="${t('currencies.default')}">${t('currencies.default')}</span>`
                : `<button class="btn secondary" type="button" data-action="set-default">${t('currencies.set_default')}</button>`
            }
            <button class="icon-btn" type="button" data-action="edit" aria-label="${t('edit')}" title="${t('edit')}">✏️</button>
            <button class="icon-btn" type="button" data-action="delete" aria-label="${t('delete')}" title="${t('delete')}" ${canDelete ? '' : 'disabled'}>🗑️</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="crud-row" role="listitem" data-code="${code}">
        <div class="crud-name currency-row">
          <div><strong>${escapeHtml(code)}</strong></div>
          <div class="crud-edit-grid">
            <label class="visually-hidden" for="currency-edit-symbol-${code}">${t('currencies.symbol')}</label>
            <input class="crud-edit-input" id="currency-edit-symbol-${code}" type="text" value="${escapeHtml(symbol)}" placeholder="${t('currencies.symbol')}" autocomplete="off" />
            <label class="visually-hidden" for="currency-edit-name-${code}">${t('currencies.name')}</label>
            <input class="crud-edit-input" id="currency-edit-name-${code}" type="text" value="${escapeHtml(name)}" placeholder="${t('currencies.name')}" autocomplete="off" />
          </div>
        </div>
        <div class="crud-actions">
          <button class="btn primary" type="button" data-action="save">${t('save')}</button>
          <button class="btn secondary" type="button" data-action="cancel">${t('cancel')}</button>
        </div>
      </div>
    `;
  }

  async _onClick(e) {
    if (e.target?.id === 'currency-add-btn') {
      const codeInput = this.shadowRoot.getElementById('currency-code');
      const symbolInput = this.shadowRoot.getElementById('currency-symbol');
      const nameInput = this.shadowRoot.getElementById('currency-name');

      const code = normalizeCode(codeInput?.value);
      const symbol = normalizeDisplay(symbolInput?.value);
      const name = normalizeDisplay(nameInput?.value) || code;

      if (!code) return;
      if (!/^[A-Z]{3}$/.test(code)) {
        showToast(t('currencies.code.invalid'), { variant: 'warning' });
        return;
      }

      const existing = await db.get('catalog_currencies', code);
      if (existing) {
        showToast(t('catalog.duplicate'), { variant: 'warning' });
        return;
      }

      await db.add('catalog_currencies', { code, name, symbol, createdAt: new Date() });
      if (codeInput) codeInput.value = '';
      if (symbolInput) symbolInput.value = '';
      if (nameInput) nameInput.value = '';
      await this.refresh();
      this._emitChanged();
      return;
    }

    const row = e.target.closest('.crud-row');
    if (!row) return;
    const code = row.getAttribute('data-code');
    const action = e.target.getAttribute('data-action');
    if (!code || !action) return;

    if (action === 'edit') {
      this._editingCode = code;
      this.render();
      this.shadowRoot.getElementById(`currency-edit-symbol-${code}`)?.focus();
      return;
    }

    if (action === 'cancel') {
      this._editingCode = null;
      this.render();
      return;
    }

    if (action === 'save') {
      const symbolInput = this.shadowRoot.getElementById(`currency-edit-symbol-${code}`);
      const nameInput = this.shadowRoot.getElementById(`currency-edit-name-${code}`);
      const symbol = normalizeDisplay(symbolInput?.value);
      const name = normalizeDisplay(nameInput?.value) || code;
      await this._update(code, { symbol, name });
      this._editingCode = null;
      await this.refresh();
      this._emitChanged();
      return;
    }

    if (action === 'set-default') {
      await this._setDefault(code);
      await this.refresh();
      this._emitChanged();
      return;
    }

    if (action === 'delete') {
      await this._delete(code);
    }
  }

  async _update(code, { name, symbol }) {
    const current = await db.get('catalog_currencies', code);
    if (!current) return;
    await db.put('catalog_currencies', { ...current, name, symbol });
  }

  async _setDefault(code) {
    await db.put('meta', { key: 'defaultCurrencyCode', value: String(code) });
    this._defaultCode = String(code);
    showToast(t('currencies.default.updated'), { variant: 'success' });
  }

  async _delete(code) {
    const items = await db.getAll('catalog_currencies');
    const list = items || [];
    if (list.length <= 1) {
      showToast(t('currencies.cannot_delete_last'), { variant: 'warning' });
      return;
    }

    const current = list.find((c) => String(c.code) === String(code));
    if (!current) return;

    const isDefault = String(this._defaultCode || '') === String(code);
    const confirmed = await dialog.confirm({
      title: t('confirm.delete_currency.title'),
      message: t('confirm.delete_currency.body'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      variant: 'danger',
    });
    if (!confirmed) return;

    if (isDefault) {
      const nextDefault = list.find((c) => String(c.code) !== String(code))?.code;
      if (nextDefault) {
        await db.put('meta', { key: 'defaultCurrencyCode', value: String(nextDefault) });
        this._defaultCode = String(nextDefault);
      }
    }

    await db.delete('catalog_currencies', String(code));
    await this.refresh();
    this._emitChanged();
  }

  _emitChanged() {
    this.dispatchEvent(new CustomEvent('ll-currency-changed', { bubbles: true, composed: true }));
  }
}

customElements.define('ll-currencies-crud', LlCurrenciesCrud);
