import { t } from '../i18n/loader.js';
import './ui-toast.js';
import './ui-dialog.js';
import './ui-empty-state.js';
import { sharedStylesTag } from './shared-styles.js';
import './ll-vendors-crud.js';
import './ll-expense-types-crud.js';
import './ll-currencies-crud.js';
import './ll-company-settings.js';
import './ll-movement-details.js';

class LlApp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._view = 'main';
  }

  connectedCallback() {
    this.render();
  }

  setView(view) {
    this._view = view || 'main';
    const main = this.shadowRoot.getElementById('view-main');
    const vendors = this.shadowRoot.getElementById('view-vendors');
    const expenseTypes = this.shadowRoot.getElementById('view-expense-types');
    const currencies = this.shadowRoot.getElementById('view-currencies');
    const company = this.shadowRoot.getElementById('view-company');
    if (main) main.hidden = this._view !== 'main';
    if (vendors) vendors.hidden = this._view !== 'vendors';
    if (expenseTypes) expenseTypes.hidden = this._view !== 'expenseTypes';
    if (currencies) currencies.hidden = this._view !== 'currencies';
    if (company) company.hidden = this._view !== 'company';

    const fab = this.shadowRoot.getElementById('fab-add-movement');
    if (fab) fab.hidden = this._view !== 'main';

    if (this._view === 'vendors') {
      this.shadowRoot.querySelector('ll-vendors-crud')?.refresh?.();
    }
    if (this._view === 'expenseTypes') {
      this.shadowRoot.querySelector('ll-expense-types-crud')?.refresh?.();
    }
    if (this._view === 'currencies') {
      this.shadowRoot.querySelector('ll-currencies-crud')?.refresh?.();
    }
    if (this._view === 'company') {
      this.shadowRoot.querySelector('ll-company-settings')?.refresh?.();
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="app-shell">
        <ll-header></ll-header>
        <main class="container">
          <section id="view-main">
            <ll-movement-list></ll-movement-list>
          </section>
          <section id="view-vendors" hidden>
            <ll-vendors-crud></ll-vendors-crud>
          </section>
          <section id="view-expense-types" hidden>
            <ll-expense-types-crud></ll-expense-types-crud>
          </section>
          <section id="view-currencies" hidden>
            <ll-currencies-crud></ll-currencies-crud>
          </section>
          <section id="view-company" hidden>
            <ll-company-settings></ll-company-settings>
          </section>
        </main>
        <ll-movement-form></ll-movement-form>
        <ll-movement-details></ll-movement-details>
        <ll-export-dialog></ll-export-dialog>
        <button id="fab-add-movement" class="fab fab-fixed" type="button" aria-label="${t('fab.add')}" title="${t('fab.add')}">+</button>
      </div>
    `;
    this.setView(this._view);
  }
}

customElements.define('ll-app', LlApp);
