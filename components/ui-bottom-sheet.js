import { t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';
import { lockBodyScroll, unlockBodyScroll } from './ui-scroll-lock.js';
import { registerModal, unregisterModal } from './ui-dialog.js';

export class UiBottomSheet extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._resolver = null;
    this._items = [];
    this._filteredItems = [];
    this._selectedValue = null;
    this._title = '';
    this._layout = 'list';
    this._columns = 1;
    this._searchable = false;
    this._allowAdd = false;
    this._addPlaceholder = '';
    this._addButtonLabel = '';
    this._emptyText = '';
    this._modalToken = null;
    this._restoreFocusEl = null;
    this._onI18nUpdated = () => {
      if (this.style.display === 'none') this.render();
    };
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.render();
    this.hide();

    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target?.id === 'sheet-backdrop') this.cancel();
      if (e.target?.id === 'sheet-close') this.cancel();
      if (e.target?.id === 'sheet-add-btn') this._submitAdd();

      const itemBtn = e.target.closest('[data-value]');
      if (itemBtn) {
        this.select(itemBtn.getAttribute('data-value'));
      }
    });

    this.shadowRoot.addEventListener('input', (e) => {
      if (e.target?.id !== 'sheet-search') return;
      const q = String(e.target.value || '').trim().toLowerCase();
      this._filteredItems = q
        ? this._items.filter((it) => it.label.toLowerCase().includes(q))
        : this._items;
      this.renderList();
    });

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });

    this.shadowRoot.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target?.id !== 'sheet-add-input') return;
      e.preventDefault();
      this._submitAdd();
    });
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
  }

  open({
    title,
    items,
    selectedValue,
    searchable = false,
    layout = 'list',
    columns = 1,
    allowAdd = false,
    addPlaceholder = '',
    addButtonLabel = '',
    emptyText = '',
  }) {
    this._title = String(title || '');
    this._items = Array.isArray(items) ? items : [];
    this._filteredItems = this._items;
    this._selectedValue = selectedValue == null ? null : String(selectedValue);
    this._searchable = Boolean(searchable);
    this._allowAdd = Boolean(allowAdd);
    this._addPlaceholder = String(addPlaceholder || '');
    this._addButtonLabel = String(addButtonLabel || '');
    this._emptyText = String(emptyText || '');
    this._layout = layout === 'grid' ? 'grid' : 'list';
    this._columns = Math.max(1, Number(columns) || 1);

    if (this._layout === 'grid' && this._shouldForceListOnMobile()) {
      this._layout = 'list';
      this._columns = 1;
    }

    this.renderHeader({ searchable: this._searchable, allowAdd: this._allowAdd });
    this.renderList();
    this._restoreFocusEl = document.activeElement;
    this.style.display = 'block';
    lockBodyScroll();
    this._modalToken = registerModal({ close: () => this.cancel(), restoreFocusEl: this._restoreFocusEl });

    return new Promise((resolve) => {
      this._resolver = resolve;
      queueMicrotask(() => {
        const search = this.shadowRoot.getElementById('sheet-search');
        if (search) {
          search.focus();
          return;
        }

        const addInput = this.shadowRoot.getElementById('sheet-add-input');
        if (addInput) {
          addInput.focus();
          return;
        }

        const value = this._selectedValue;
        const escape = (v) => {
          try {
            return typeof globalThis.CSS?.escape === 'function' ? globalThis.CSS.escape(v) : v;
          } catch {
            return v;
          }
        };
        const selectedBtn = value == null ? null : this.shadowRoot.querySelector(`.sheet-item[data-value="${escape(value)}"]`);
        if (selectedBtn) {
          selectedBtn.focus();
          return;
        }

        const firstBtn = this.shadowRoot.querySelector('.sheet-item');
        if (firstBtn) {
          firstBtn.focus();
          return;
        }

        this.shadowRoot.getElementById('sheet-close')?.focus();
      });
    });
  }

  _shouldForceListOnMobile() {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  }

  hide() {
    this.style.display = 'none';
  }

  cancel() {
    this.hide();
    unlockBodyScroll();
    if (this._modalToken) {
      const token = this._modalToken;
      this._modalToken = null;
      unregisterModal(token);
    }
    if (this._resolver) this._resolver(null);
    this._resolver = null;
  }

  select(value) {
    this.hide();
    unlockBodyScroll();
    if (this._modalToken) {
      const token = this._modalToken;
      this._modalToken = null;
      unregisterModal(token);
    }
    if (this._resolver) this._resolver(value);
    this._resolver = null;
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="overlay sheet-overlay" role="presentation" aria-hidden="false">
        <div id="sheet-backdrop" class="sheet-backdrop" aria-hidden="true"></div>
        <div class="sheet card" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div class="sheet-header">
            <div class="sheet-title-row">
              <h2 class="sheet-title" id="sheet-title"></h2>
              <button class="icon-btn" id="sheet-close" type="button" aria-label="${t('close')}" title="${t('close')}">✕</button>
            </div>
            <div class="sheet-search-row" id="sheet-search-row"></div>
          </div>
          <div class="sheet-body" id="sheet-body"></div>
        </div>
      </div>
    `;
  }

  renderHeader({ searchable, allowAdd }) {
    this.shadowRoot.getElementById('sheet-title').textContent = this._title;
    const searchRow = this.shadowRoot.getElementById('sheet-search-row');
    if (!searchRow) return;

    if (searchable) {
      searchRow.innerHTML = `
        <label class="visually-hidden" for="sheet-search">${t('search')}</label>
        <input id="sheet-search" type="search" placeholder="${t('search')}" inputmode="search" autocomplete="off" />
      `;
    } else if (allowAdd) {
      const placeholder = this._addPlaceholder || t('add.new.placeholder');
      const addLabel = this._addButtonLabel || t('add.new');
      searchRow.innerHTML = `
        <div class="sheet-add-row">
          <label class="visually-hidden" for="sheet-add-input">${addLabel}</label>
          <input id="sheet-add-input" type="text" placeholder="${placeholder}" autocomplete="off" />
          <button class="btn secondary" id="sheet-add-btn" type="button">${addLabel}</button>
        </div>
      `;
    } else {
      searchRow.innerHTML = '';
    }
  }

  renderList() {
    const body = this.shadowRoot.getElementById('sheet-body');
    if (!body) return;
    const selected = this._selectedValue;
    const cols = Math.max(1, Math.min(4, this._columns));
    const colsClass = this._layout === 'grid' ? `sheet-cols-${cols}` : '';
    const emptyText = this._emptyText || t('no.items.yet');

    body.innerHTML = `
      ${
        this._filteredItems.length === 0
          ? `<div class="sheet-empty" role="note">${emptyText}</div>`
          : `
            <div class="sheet-list ${this._layout === 'grid' ? 'sheet-list--grid' : ''} ${colsClass}" role="list">
              ${this._filteredItems
                .map((it) => {
                  if (it?.kind === 'section') {
                    return `<div class="sheet-section" role="presentation">${it.label}</div>`;
                  }
                  const value = String(it.value);
                  const isSelected = selected != null && value === selected;
                  return `
                    <button
                      type="button"
                      class="sheet-item"
                      data-value="${value}"
                      aria-current="${isSelected ? 'true' : 'false'}"
                    >
                      <span class="sheet-item-label">${it.label}</span>
                      <span class="sheet-item-mark" aria-hidden="true">${isSelected ? '✓' : ''}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          `
      }
    `;
  }

  _normalizeFreeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  _submitAdd() {
    if (!this._allowAdd) return;
    const input = this.shadowRoot.getElementById('sheet-add-input');
    if (!input) return;
    const normalized = this._normalizeFreeText(input.value);
    if (!normalized) return;
    this.select(normalized);
  }
}

customElements.define('ui-bottom-sheet', UiBottomSheet);
