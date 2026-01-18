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
    this._inputHandler = null;
    this._phraseCopyHandler = null;
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
            <div class="dialog-phrase" id="phrase-row" hidden>
              <div class="dialog-phrase__label" id="phrase-label"></div>
              <div class="dialog-phrase__pill">
                <code class="dialog-phrase__code" id="phrase-code"></code>
                <button class="icon-btn dialog-phrase__copy" id="phrase-copy" type="button"></button>
              </div>
            </div>
            <label class="dialog-field" id="input-row" hidden>
              <span class="dialog-field__label" id="input-label"></span>
              <input class="dialog-field__input" id="input" type="text" />
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

  confirmPhrase({
    title,
    message,
    phraseLabel,
    phrase,
    phraseHintLabel = '',
    placeholder = '',
    copyLabel = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    matchMode = 'case_insensitive_trim',
  }) {
    const expected = String(phrase || '');
    const normalize = (s) => {
      const base = String(s ?? '');
      if (matchMode === 'case_insensitive_trim') return base.trim().toLowerCase();
      return base;
    };
    const expectedNormalized = normalize(expected);

    return new Promise((resolve) => {
      this.resolve = resolve;
      this._resultMapper = null;
      this._restoreFocusEl = document.activeElement;

      this.shadowRoot.getElementById('title').textContent = String(title || '');
      this.shadowRoot.getElementById('message').textContent = String(message || '');
      this._setDetails({ summary: '', details: '' });
      this._setOptionRow(null);
      this._setPhraseRow(null);
      this._removeCopyButton();

      this._setPhraseRow({
        label: phraseHintLabel,
        phrase: expected,
        copyLabel,
      });

      const inputRow = this.shadowRoot.getElementById('input-row');
      const inputLabelEl = this.shadowRoot.getElementById('input-label');
      const inputEl = this.shadowRoot.getElementById('input');
      if (inputRow && inputLabelEl && inputEl) {
        inputRow.hidden = false;
        inputLabelEl.textContent = String(phraseLabel || '');
        inputEl.value = '';
        inputEl.placeholder = String(placeholder || '');
        inputEl.autocomplete = 'off';
        inputEl.spellcheck = false;
      }

      const confirmBtn = this.shadowRoot.getElementById('confirm-btn');
      confirmBtn.textContent = String(confirmLabel || '');
      confirmBtn.className = 'btn';
      confirmBtn.classList.add(variant);
      confirmBtn.disabled = true;

      const cancelBtn = this.shadowRoot.getElementById('cancel-btn');
      cancelBtn.hidden = false;
      cancelBtn.textContent = String(cancelLabel || '');

      const updateDisabled = () => {
        const val = normalize(inputEl?.value ?? '');
        const ok = expectedNormalized && val === expectedNormalized;
        confirmBtn.disabled = !ok;
      };
      updateDisabled();

      if (this._inputHandler && inputEl) {
        try {
          inputEl.removeEventListener('input', this._inputHandler);
        } catch {
          // no-op
        }
      }
      this._inputHandler = updateDisabled;
      inputEl?.addEventListener('input', updateDisabled);

      this.style.display = 'flex';
      lockBodyScroll();
      this._modalToken = registerModal({ close: () => this._handle(false), restoreFocusEl: this._restoreFocusEl });
      queueMicrotask(() => inputEl?.focus());
    });
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
      this._setInputRow(null);
      this._setPhraseRow(null);
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

  _setInputRow(input) {
    const row = this.shadowRoot.getElementById('input-row');
    const label = this.shadowRoot.getElementById('input-label');
    const el = this.shadowRoot.getElementById('input');
    if (!row || !label || !el) return;
    if (this._inputHandler) {
      try {
        el.removeEventListener('input', this._inputHandler);
      } catch {
        // no-op
      }
      this._inputHandler = null;
    }
    row.hidden = true;
    label.textContent = '';
    el.value = '';
    el.placeholder = '';
    if (!input) return;
    row.hidden = false;
    label.textContent = String(input.label || '');
    el.value = String(input.value || '');
    el.placeholder = String(input.placeholder || '');
  }

  async _copyPhrase(text) {
    const value = String(text || '');
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        showToast(t('copy.success'), { variant: 'success', duration: 1200 });
        return;
      }
    } catch {
      // fallback below
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        showToast(t('copy.success'), { variant: 'success', duration: 1200 });
        return;
      }
    } catch {
      // no-op
    }

    showToast(t('copy.failed'), { variant: 'warning', duration: 1600 });
  }

  _setPhraseRow(data) {
    const row = this.shadowRoot.getElementById('phrase-row');
    const label = this.shadowRoot.getElementById('phrase-label');
    const code = this.shadowRoot.getElementById('phrase-code');
    const copyBtn = this.shadowRoot.getElementById('phrase-copy');
    if (!row || !label || !code || !copyBtn) return;

    if (this._phraseCopyHandler) {
      try {
        copyBtn.removeEventListener('click', this._phraseCopyHandler);
      } catch {
        // no-op
      }
      this._phraseCopyHandler = null;
    }

    row.hidden = true;
    label.textContent = '';
    code.textContent = '';
    copyBtn.hidden = true;
    copyBtn.textContent = '';
    copyBtn.setAttribute('aria-label', '');
    copyBtn.setAttribute('title', '');

    if (!data) return;

    const phrase = String(data.phrase || '');
    row.hidden = false;
    label.textContent = String(data.label || '');
    code.textContent = phrase;

    const copyLabel = String(data.copyLabel || '');
    if (copyLabel) {
      copyBtn.hidden = false;
      copyBtn.textContent = copyLabel;
      copyBtn.setAttribute('aria-label', copyLabel);
      copyBtn.setAttribute('title', copyLabel);
      this._phraseCopyHandler = () => void this._copyPhrase(phrase);
      copyBtn.addEventListener('click', this._phraseCopyHandler);
    }
  }
}

customElements.define('ui-dialog', UiDialog);

export const dialog = document.createElement('ui-dialog');
document.body.appendChild(dialog);
