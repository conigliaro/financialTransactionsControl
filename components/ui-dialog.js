import { sharedStylesTag } from './shared-styles.js';
import { lockBodyScroll, unlockBodyScroll } from './ui-scroll-lock.js';
import { showToast } from './ui-toast.js';
import { t } from '../i18n/loader.js';

const modalStack = [];
let globalEscInstalled = false;

function isInDocument(el) {
  try {
    return el instanceof HTMLElement && document.contains(el);
  } catch {
    return false;
  }
}

function installGlobalEscapeHandler() {
  if (globalEscInstalled) return;
  globalEscInstalled = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      const top = modalStack.at(-1);
      if (!top) return;
      e.preventDefault();
      try {
        top.close?.('escape');
      } catch {
        // no-op
      }
    },
    { capture: true },
  );
}

export function registerModal({ close, restoreFocusEl } = {}) {
  installGlobalEscapeHandler();
  const token = {
    close: typeof close === 'function' ? close : null,
    restoreFocusEl: restoreFocusEl || null,
  };
  modalStack.push(token);
  return token;
}

export function unregisterModal(token) {
  const idx = modalStack.lastIndexOf(token);
  if (idx >= 0) modalStack.splice(idx, 1);
  const restore = token?.restoreFocusEl;
  if (isInDocument(restore)) {
    try {
      restore.focus();
    } catch {
      // no-op
    }
  }
}

class UiDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.resolve = null;
    this._detailsText = '';
    this._modalToken = null;
    this._restoreFocusEl = null;
    this._resultMapper = null;
  }

  connectedCallback() {
    if (!this.style.display) this.style.display = 'none';
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="overlay" role="presentation" id="dialog-overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="title" id="dialog-panel" tabindex="-1">
          <div class="modal-header">
            <h2 class="modal-title" id="title"></h2>
            <span></span>
          </div>
          <div class="modal-body">
            <div id="message"></div>
            <label class="dialog-check" id="opt-row" hidden>
              <input type="checkbox" id="opt-check" />
              <span id="opt-label"></span>
            </label>
            <details class="dialog-details" id="details" hidden>
              <summary id="details-summary"></summary>
              <pre class="dialog-details-pre" id="details-pre"></pre>
            </details>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" id="cancel-btn" type="button"></button>
            <button class="btn" id="confirm-btn" type="button"></button>
          </div>
        </div>
      </div>
    `;

    const overlay = this.shadowRoot.getElementById('dialog-overlay');
    const panel = this.shadowRoot.getElementById('dialog-panel');
    overlay?.addEventListener('click', (e) => {
      if (e.target !== overlay) return;
      this._handle(false);
    });
    overlay?.addEventListener('pointerup', (e) => {
      if (e.target !== overlay) return;
      this._handle(false);
    });
    panel?.addEventListener('click', (e) => e.stopPropagation());

    this.shadowRoot.getElementById('cancel-btn').addEventListener('click', () => this._handle(false));
    this.shadowRoot.getElementById('confirm-btn').addEventListener('click', () => this._handle(true));
  }

  _removeCopyButton() {
    this.shadowRoot.getElementById('copy-btn')?.remove();
  }

  _ensureCopyButton() {
    const footer = this.shadowRoot.querySelector('.modal-footer');
    if (!footer) return null;

    const existing = this.shadowRoot.getElementById('copy-btn');
    if (existing) return existing;

    const btn = document.createElement('button');
    btn.id = 'copy-btn';
    btn.type = 'button';
    btn.className = 'btn secondary';
    btn.addEventListener('click', () => this._copyDetails());

    const confirmBtn = this.shadowRoot.getElementById('confirm-btn');
    if (confirmBtn && confirmBtn.parentNode === footer) footer.insertBefore(btn, confirmBtn);
    else footer.appendChild(btn);

    return btn;
  }

  confirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'primary' }) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this._resultMapper = null;
      this._restoreFocusEl = document.activeElement;
      this.shadowRoot.getElementById('title').textContent = title;
      this.shadowRoot.getElementById('message').textContent = message;
      this.shadowRoot.getElementById('confirm-btn').textContent = confirmLabel;
      this.shadowRoot.getElementById('cancel-btn').textContent = cancelLabel;
      this._setDetails({ summary: '', details: '' });
      this._setOptionRow(null);

      const confirmBtn = this.shadowRoot.getElementById('confirm-btn');
      confirmBtn.className = 'btn';
      confirmBtn.classList.add(variant);

      const cancelBtn = this.shadowRoot.getElementById('cancel-btn');
      cancelBtn.hidden = false;

      this._removeCopyButton();
      
      this.style.display = 'flex';
      lockBodyScroll();
      this._modalToken = registerModal({ close: () => this._handle(false), restoreFocusEl: this._restoreFocusEl });
      queueMicrotask(() => {
        const cancel = this.shadowRoot.getElementById('cancel-btn');
        if (!cancel?.hidden) {
          cancel.focus();
          return;
        }
        this.shadowRoot.getElementById('confirm-btn')?.focus();
      });
    });
  }

  alert({ title, message, details = '', detailsLabel = 'Details', closeLabel = 'Close', copyLabel = 'Copy details' }) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this._resultMapper = null;
      this._restoreFocusEl = document.activeElement;
      this.shadowRoot.getElementById('title').textContent = title;
      this.shadowRoot.getElementById('message').textContent = message;
      this._setOptionRow(null);

      const cancelBtn = this.shadowRoot.getElementById('cancel-btn');
      cancelBtn.hidden = true;

      this._detailsText = String(details || '');
      if (this._detailsText) {
        const copyBtn = this._ensureCopyButton();
        if (copyBtn) copyBtn.textContent = copyLabel;
        this._setDetails({ summary: detailsLabel, details: this._detailsText });
      } else {
        this._removeCopyButton();
        this._setDetails({ summary: '', details: '' });
      }

      const confirmBtn = this.shadowRoot.getElementById('confirm-btn');
      confirmBtn.className = 'btn primary';
      confirmBtn.textContent = closeLabel;

      this.style.display = 'flex';
      lockBodyScroll();
      this._modalToken = registerModal({ close: () => this._handle(true), restoreFocusEl: this._restoreFocusEl });
      queueMicrotask(() => this.shadowRoot.getElementById('confirm-btn')?.focus());
    });
  }

  firstRun({
    title,
    bodyLines = [],
    ctaLabel = 'OK',
    dontShowAgainLabel = "Don't show again",
    defaultDontShowAgain = true,
  }) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this._restoreFocusEl = document.activeElement;

      this.shadowRoot.getElementById('title').textContent = String(title || '');
      const msg = Array.isArray(bodyLines) ? bodyLines.filter(Boolean).map((s) => String(s)) : [];
      this.shadowRoot.getElementById('message').textContent = msg.join('\n\n');
      this._setDetails({ summary: '', details: '' });
      this._removeCopyButton();

      const cancelBtn = this.shadowRoot.getElementById('cancel-btn');
      cancelBtn.hidden = true;

      const confirmBtn = this.shadowRoot.getElementById('confirm-btn');
      confirmBtn.className = 'btn primary';
      confirmBtn.textContent = String(ctaLabel || '');

      this._setOptionRow({ label: dontShowAgainLabel, checked: Boolean(defaultDontShowAgain) });

      this._resultMapper = (confirmed) => {
        const checked = Boolean(this.shadowRoot.getElementById('opt-check')?.checked);
        return { confirmed: Boolean(confirmed), dontShowAgain: Boolean(confirmed) && checked };
      };

      this.style.display = 'flex';
      lockBodyScroll();
      this._modalToken = registerModal({ close: () => this._handle(false), restoreFocusEl: this._restoreFocusEl });
      queueMicrotask(() => this.shadowRoot.getElementById('confirm-btn')?.focus());
    });
  }

  _setDetails({ summary, details }) {
    const detailsEl = this.shadowRoot.getElementById('details');
    const summaryEl = this.shadowRoot.getElementById('details-summary');
    const preEl = this.shadowRoot.getElementById('details-pre');
    const text = String(details || '');

    if (!detailsEl || !summaryEl || !preEl) return;
    if (!text) {
      detailsEl.hidden = true;
      summaryEl.textContent = '';
      preEl.textContent = '';
      return;
    }
    detailsEl.hidden = false;
    summaryEl.textContent = String(summary || '');
    preEl.textContent = text;
  }

  async _copyDetails() {
    const text = String(this._detailsText || '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('copy.success'), { variant: 'success', duration: 1200 });
    } catch {
      showToast(t('copy.failed'), { variant: 'warning', duration: 1600 });
    }
  }

  _handle(confirmed) {
    this.style.display = 'none';
    unlockBodyScroll();
    if (this._modalToken) {
      const token = this._modalToken;
      this._modalToken = null;
      unregisterModal(token);
    }
    if (this.resolve) {
      const mapper = this._resultMapper;
      this._resultMapper = null;
      const result = mapper ? mapper(confirmed) : confirmed;
      this._setOptionRow(null);
      this.resolve(result);
    }
  }

  _setOptionRow(option) {
    const row = this.shadowRoot.getElementById('opt-row');
    const check = this.shadowRoot.getElementById('opt-check');
    const label = this.shadowRoot.getElementById('opt-label');
    if (!row || !check || !label) return;
    if (!option) {
      row.hidden = true;
      label.textContent = '';
      check.checked = false;
      return;
    }
    row.hidden = false;
    label.textContent = String(option.label || '');
    check.checked = Boolean(option.checked);
  }
}

customElements.define('ui-dialog', UiDialog);

export const dialog = document.createElement('ui-dialog');
document.body.appendChild(dialog);
