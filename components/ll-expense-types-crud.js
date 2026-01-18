import { t } from '../i18n/loader.js';
import { db } from '../db/indexeddb.js';
import { showToast } from './ui-toast.js';
import { dialog } from './ui-dialog.js';
import { sharedStylesTag } from './shared-styles.js';

function normalizeDisplay(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return normalizeDisplay(value).toLowerCase();
}

export class LlExpenseTypesCrud extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._editingId = null;
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
    const items = await db.getAll('catalog_expense_types');
    this._items = (items || []).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <section class="crud" aria-label="${t('expense.types')}">
        <div class="crud-header">
          <h2 class="crud-title">${t('expense.types')}</h2>
          <p class="crud-subtitle">${t('expense.types.subtitle')}</p>
        </div>

        <div class="crud-add">
          <label class="visually-hidden" for="expense-type-new">${t('add.new')}</label>
          <input id="expense-type-new" type="text" placeholder="${t('expense.types.add.placeholder')}" autocomplete="off" />
          <button class="btn primary" id="expense-type-add-btn" type="button">${t('add.new')}</button>
        </div>

        <div class="crud-list card" role="list">
          ${this._items.length === 0 ? `<div class="crud-empty">${t('no.items.yet')}</div>` : ''}
          ${this._items.map((it) => this._renderRow(it)).join('')}
        </div>
      </section>
    `;
  }

  _renderRow(it) {
    const id = String(it.id);
    const isEditing = this._editingId === id;
    if (!isEditing) {
      return `
        <div class="crud-row" role="listitem" data-id="${id}">
          <div class="crud-name">${it.name}</div>
          <div class="crud-actions">
            <button class="icon-btn" type="button" data-action="edit" aria-label="${t('edit')}" title="${t('edit')}">✏️</button>
            <button class="icon-btn" type="button" data-action="delete" aria-label="${t('delete')}" title="${t('delete')}">🗑️</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="crud-row" role="listitem" data-id="${id}">
        <input class="crud-edit-input" type="text" value="${String(it.name).replace(/"/g, '&quot;')}" autocomplete="off" />
        <div class="crud-actions">
          <button class="btn primary" type="button" data-action="save">${t('save')}</button>
          <button class="btn secondary" type="button" data-action="cancel">${t('cancel')}</button>
        </div>
      </div>
    `;
  }

  async _onClick(e) {
    const addBtn = e.target?.id === 'expense-type-add-btn' ? e.target : null;
    if (addBtn) {
      const input = this.shadowRoot.getElementById('expense-type-new');
      const value = normalizeDisplay(input?.value);
      if (!value) return;
      await this._upsert(value);
      if (input) input.value = '';
      return;
    }

    const row = e.target.closest('.crud-row');
    if (!row) return;
    const id = row.getAttribute('data-id');
    const action = e.target.getAttribute('data-action');
    if (!id || !action) return;

    if (action === 'edit') {
      this._editingId = id;
      this.render();
      row.querySelector('.crud-edit-input')?.focus();
      return;
    }

    if (action === 'cancel') {
      this._editingId = null;
      this.render();
      return;
    }

    if (action === 'save') {
      const input = row.querySelector('.crud-edit-input');
      const value = normalizeDisplay(input?.value);
      if (!value) return;
      await this._rename(id, value);
      this._editingId = null;
      await this.refresh();
      this._emitChanged();
      return;
    }

    if (action === 'delete') {
      await this._delete(id);
    }
  }

  async _upsert(name) {
    const key = normalizeKey(name);
    const items = await db.getAll('catalog_expense_types');
    const exists = (items || []).some((et) => normalizeKey(et.normalizedName || et.name) === key);
    if (exists) {
      showToast(t('catalog.duplicate'), { variant: 'warning' });
      return;
    }
    await db.add('catalog_expense_types', { name, normalizedName: key, createdAt: new Date() });
    await this.refresh();
    this._emitChanged();
  }

  async _rename(id, nextName) {
    const key = normalizeKey(nextName);
    const items = await db.getAll('catalog_expense_types');
    const current = (items || []).find((et) => String(et.id) === String(id));
    if (!current) return;
    const exists = (items || []).some((et) => String(et.id) !== String(id) && normalizeKey(et.normalizedName || et.name) === key);
    if (exists) {
      showToast(t('catalog.duplicate'), { variant: 'warning' });
      return;
    }
    await db.put('catalog_expense_types', { ...current, name: nextName, normalizedName: key });
  }

  async _delete(id) {
    const items = await db.getAll('catalog_expense_types');
    const current = (items || []).find((et) => String(et.id) === String(id));
    if (!current) return;

    const movements = await db.getAll('movements');
    const inUse = (movements || []).some((m) => normalizeKey(m.expenseType) === normalizeKey(current.name));
    if (inUse) {
      showToast(t('catalog.delete.in_use'), { variant: 'warning' });
      return;
    }

    const confirmed = await dialog.confirm({
      title: t('confirm.delete.title'),
      message: t('confirm.delete.catalog.body'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      variant: 'danger',
    });
    if (!confirmed) return;

    await db.delete('catalog_expense_types', Number(current.id));
    await this.refresh();
    this._emitChanged();
  }

  _emitChanged() {
    this.dispatchEvent(new CustomEvent('ll-catalog-changed', { bubbles: true, composed: true }));
  }
}

customElements.define('ll-expense-types-crud', LlExpenseTypesCrud);
