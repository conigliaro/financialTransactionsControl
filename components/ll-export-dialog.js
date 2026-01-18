import { t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';
import { lockBodyScroll, unlockBodyScroll } from './ui-scroll-lock.js';
import { registerModal, unregisterModal } from './ui-dialog.js';

class LlExportDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._modalToken = null;
    this._restoreFocusEl = null;
    this._onI18nUpdated = () => {
      if (this.style.display === 'none') this.render();
    };
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.render();
    this.style.display = 'none';

    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target?.classList?.contains('overlay')) this.hide();
      if (e.target?.closest?.('.modal')) e.stopPropagation();
    });
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="overlay" role="presentation">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div class="modal-header">
            <h2 class="modal-title" id="export-title">${t('export.dialog.title')}</h2>
            <button type="button" class="icon-btn" id="close-btn" aria-label="${t('close')}" title="${t('close')}">✕</button>
          </div>
          <div class="modal-body">
            <div class="kv"><span>${t('export.dialog.company_name')}</span><strong id="company-name-display"></strong></div>
            <div class="kv"><span>${t('export.dialog.period')}</span><strong id="period-display"></strong></div>
          </div>
          <div class="modal-footer">
            <button id="export-csv-btn" class="btn primary" type="button">${t('export.csv')}</button>
            <button id="export-xlsx-btn" class="btn secondary" type="button" disabled aria-disabled="true">${t('export.xlsx')} · ${t('soon')}</button>
          </div>
        </div>
      </div>
    `;
  }

  show() {
    this._restoreFocusEl = document.activeElement;
    this.style.display = 'block';
    lockBodyScroll();
    this._modalToken = registerModal({ close: () => this.hide(), restoreFocusEl: this._restoreFocusEl });
    queueMicrotask(() => this.shadowRoot.getElementById('close-btn')?.focus());
  }

  hide() {
    this.style.display = 'none';
    unlockBodyScroll();
    if (this._modalToken) {
      const token = this._modalToken;
      this._modalToken = null;
      unregisterModal(token);
    }
  }
}

customElements.define('ll-export-dialog', LlExportDialog);
