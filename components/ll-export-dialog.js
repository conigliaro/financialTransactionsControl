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
    this._companyName = '';
    this._period = '';
    this._busy = false;
    this._status = '';
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
            <div class="export-status" id="export-status" ${this._status ? '' : 'hidden'}></div>
          </div>
          <div class="modal-footer">
            <button id="export-csv-btn" class="btn primary" type="button" ${this._busy ? 'disabled' : ''}>${t('export.csv')}</button>
            <button id="export-xlsx-btn" class="btn secondary" type="button" ${this._busy ? 'disabled' : ''}>${t('export.xlsx')}</button>
          </div>
        </div>
      </div>
    `;

    const companyEl = this.shadowRoot.getElementById('company-name-display');
    if (companyEl) companyEl.textContent = this._companyName || '';
    const periodEl = this.shadowRoot.getElementById('period-display');
    if (periodEl) periodEl.textContent = this._period || '';
    const statusEl = this.shadowRoot.getElementById('export-status');
    if (statusEl) statusEl.textContent = this._status || '';
  }

  setInfo({ companyName, period } = {}) {
    this._companyName = companyName == null ? '' : String(companyName);
    this._period = period == null ? '' : String(period);
    this.render();
  }

  setBusy({ busy, status } = {}) {
    this._busy = Boolean(busy);
    this._status = status == null ? '' : String(status);
    this.render();
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
