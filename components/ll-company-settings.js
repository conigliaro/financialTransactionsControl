import { t } from '../i18n/loader.js';
import { db } from '../db/indexeddb.js';
import { showToast } from './ui-toast.js';
import { sharedStylesTag } from './shared-styles.js';

export class LlCompanySettings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._saving = false;
    this._error = '';
    this._onI18nUpdated = () => this.render();
    this._lastSaveRequestAt = 0;
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.render();

    this.shadowRoot.addEventListener('keydown', (e) => this._onKeyDown(e));

    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target?.closest?.('#cancel-btn')) this._cancel();
      if (e.target?.closest?.('#save-btn')) this._save();
    });

    this.shadowRoot.addEventListener('pointerup', (e) => {
      if (e.target?.closest?.('#save-btn')) {
        e.preventDefault();
        this._save();
      }
      if (e.target?.closest?.('#cancel-btn')) {
        e.preventDefault();
        this._cancel();
      }
    });

    this.shadowRoot.addEventListener(
      'touchend',
      (e) => {
        if (e.target?.closest?.('#save-btn')) {
          e.preventDefault();
          this._save();
        }
        if (e.target?.closest?.('#cancel-btn')) {
          e.preventDefault();
          this._cancel();
        }
      },
      { capture: true }
    );
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
  }

  async refresh() {
    const [name, subtitle] = await Promise.all([
      db.get('meta', 'companyName'),
      db.get('meta', 'companySubtitle'),
    ]);
    const nameInput = this.shadowRoot.getElementById('company-name');
    const subtitleInput = this.shadowRoot.getElementById('company-subtitle');
    if (nameInput) nameInput.value = String(name?.value || '');
    if (subtitleInput) subtitleInput.value = String(subtitle?.value || '');
    this._error = '';
    this._renderError();
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <section class="crud" aria-label="${t('company.title')}">
        <div class="crud-header">
          <h2 class="crud-title">${t('company.title')}</h2>
          <p class="crud-subtitle">${t('company.subtitle')}</p>
        </div>

        <div class="card company-card">
          <div class="company-form">
            <div class="company-field">
              <label for="company-name">${t('company.name.label')}</label>
              <input id="company-name" type="text" placeholder="${t('company.name.placeholder')}" autocomplete="off" />
              <div class="field-error" id="name-error" ${this._error ? '' : 'hidden'}>${this._error}</div>
            </div>
            <div class="company-field">
              <label for="company-subtitle">${t('company.subtitle.label')}</label>
              <input id="company-subtitle" type="text" placeholder="${t('company.subtitle.placeholder')}" autocomplete="off" />
            </div>
          </div>
        </div>

        <div class="company-actions">
          <button class="btn secondary" id="cancel-btn" type="button" ${this._saving ? 'disabled' : ''}>${t('common.cancel')}</button>
          <button class="btn primary" id="save-btn" type="button" ${this._saving ? 'disabled' : ''}>${t('common.save')}</button>
        </div>
      </section>
    `;
  }

  _renderError() {
    const err = this.shadowRoot.getElementById('name-error');
    if (!err) return;
    if (this._error) {
      err.textContent = this._error;
      err.hidden = false;
    } else {
      err.textContent = '';
      err.hidden = true;
    }
  }

  _setSaving(saving) {
    this._saving = Boolean(saving);
    const save = this.shadowRoot.getElementById('save-btn');
    const cancel = this.shadowRoot.getElementById('cancel-btn');
    if (save) save.toggleAttribute('disabled', this._saving);
    if (cancel) cancel.toggleAttribute('disabled', this._saving);
  }

  _onKeyDown(e) {
    const target = e.target;
    if (e.key !== 'Enter') return;
    if (!(target instanceof HTMLInputElement)) return;
    e.preventDefault();

    const order = ['#company-name', '#company-subtitle'];
    const fields = order.map((sel) => this.shadowRoot.querySelector(sel)).filter(Boolean);
    const idx = fields.indexOf(target);
    const next = fields[idx + 1];
    if (next) {
      next.focus();
      try {
        next.setSelectionRange(next.value.length, next.value.length);
      } catch {
        // no-op
      }
      return;
    }
    this._save();
  }

  _cancel() {
    if (this._saving) return;
    this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'main' } }));
  }

  async _save() {
    if (this._saving) return;
    const now = Date.now();
    if (now - this._lastSaveRequestAt < 450) return;
    this._lastSaveRequestAt = now;

    const nameInput = this.shadowRoot.getElementById('company-name');
    const subtitleInput = this.shadowRoot.getElementById('company-subtitle');
    const name = String(nameInput?.value || '').trim().replace(/\s+/g, ' ');
    const subtitle = String(subtitleInput?.value || '').trim().replace(/\s+/g, ' ');

    if (!name) {
      this._error = t('validation.required');
      this._renderError();
      nameInput?.focus?.();
      return;
    }

    this._error = '';
    this._renderError();
    this._setSaving(true);
    try {
      await db.put('meta', { key: 'companyName', value: name });
      await db.put('meta', { key: 'companySubtitle', value: subtitle });
      showToast(t('common.saved'), { variant: 'success' });

      const detail = { name, subtitle };
      try {
        window.dispatchEvent(new CustomEvent('company:updated', { detail }));
      } catch {
        // no-op
      }
      this.dispatchEvent(new CustomEvent('ll-company-updated', { bubbles: true, composed: true, detail }));
      this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'main' } }));
    } finally {
      this._setSaving(false);
    }
  }
}

customElements.define('ll-company-settings', LlCompanySettings);

