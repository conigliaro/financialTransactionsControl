import { t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';

class UiToast extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.duration = this.getAttribute('duration') || 5000;
    this.variant = this.getAttribute('variant') || 'info';
    this._closeTimeoutId = null;
    this._removeTimeoutId = null;
    this._closed = false;
  }

  connectedCallback() {
    this.render();
    this._closeTimeoutId = setTimeout(() => this.close(), Number(this.duration) || 0);
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="toast" role="alert">
        <div class="toast__inner">
          <div class="toast__dot" aria-hidden="true"></div>
          <div class="toast__message"><slot></slot></div>
          <button class="icon-btn toast__close" type="button" aria-label="${t('close')}" title="${t('close')}">✕</button>
        </div>
      </div>
    `;

    this.shadowRoot.querySelector('.toast__close').addEventListener('click', () => this.close());
  }

  close() {
    if (this._closed) return;
    this._closed = true;

    if (this._closeTimeoutId) {
      clearTimeout(this._closeTimeoutId);
      this._closeTimeoutId = null;
    }

    const toastEl = this.shadowRoot.querySelector('.toast');
    if (toastEl) toastEl.style.animation = 'ui-toast-slide-out 0.22s ease-in forwards';
    const removeToast = () => {
      if (this._removeTimeoutId) {
        clearTimeout(this._removeTimeoutId);
        this._removeTimeoutId = null;
      }
      toastEl?.removeEventListener('animationend', removeToast);
      this.remove();
    };

    toastEl?.addEventListener('animationend', removeToast, { once: true });
    this._removeTimeoutId = setTimeout(removeToast, 260);
  }
}

customElements.define('ui-toast', UiToast);

export function showToast(message, options = { variant: 'info', duration: 5000 }) {
  const toast = document.createElement('ui-toast');
  toast.textContent = message;
  toast.setAttribute('variant', options.variant);
  toast.setAttribute('duration', options.duration);
  document.body.appendChild(toast);
}
