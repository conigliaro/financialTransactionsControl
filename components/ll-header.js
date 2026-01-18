import { getActiveLang, t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';
import './ui-bottom-sheet.js';

class LlHeader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._months = [];
    this._years = [];
    const now = new Date();
    this._month = now.getMonth() + 1;
    this._year = now.getFullYear();
    this._theme = 'light';
    this._view = 'main';
    this._userName = null;
    this._companyName = null;
    this._companySubtitle = null;
    this._isMobile = this._computeIsMobile();
    this._onResize = () => {
      const next = this._computeIsMobile();
      if (next !== this._isMobile) {
        this._isMobile = next;
        this.render();
      }
    };
    this._onI18nUpdated = () => this.render();
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    window.addEventListener('resize', this._onResize);
    this.shadowRoot.addEventListener('click', (e) => {
      if (this._eventPathHasId(e, 'back-btn')) {
        this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'main' } }));
        return;
      }
      if (this._eventPathHasId(e, 'export-btn')) {
        this.dispatchEvent(new CustomEvent('ll-export', { bubbles: true, composed: true }));
        return;
      }
    });
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
    window.removeEventListener('resize', this._onResize);
  }

  setPeriodOptions({ months, years, month, year }) {
    if (Array.isArray(months)) this._months = months;
    if (Array.isArray(years)) this._years = years;
    if (Number.isFinite(Number(month))) this._month = Number(month);
    if (Number.isFinite(Number(year))) this._year = Number(year);
    this.render();
  }

  getPeriod() {
    return { month: this._month, year: this._year };
  }

  _monthLabel() {
    const found = this._months.find((m) => Number(m.value) === Number(this._month));
    return found?.label || new Date(this._year, this._month - 1, 1).toLocaleString(navigator.language, { month: 'long' });
  }

  setView(view) {
    this._view = view || 'main';
    this.render();
  }

  setUser({ name } = {}) {
    this._userName = name || null;
    this.render();
  }

  setCompany({ name, subtitle } = {}) {
    this._companyName = name == null ? null : String(name);
    this._companySubtitle = subtitle == null ? null : String(subtitle);
    this.render();
  }

  async openMonthPicker() {
    const sheet = this.shadowRoot.getElementById('period-sheet');
    if (!sheet) return;
    const selected = await sheet.open({
      title: t('month'),
      items: this._months,
      selectedValue: this._month,
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    if (selected == null) return;
    this._month = Number(selected);
    this.dispatchEvent(new CustomEvent('ll-period-change', { bubbles: true, composed: true, detail: { month: this._month, year: this._year } }));
    this.render();
  }

  async openYearPicker() {
    const sheet = this.shadowRoot.getElementById('period-sheet');
    if (!sheet) return;
    const selected = await sheet.open({
      title: t('year'),
      items: this._years,
      selectedValue: this._year,
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    if (selected == null) return;
    this._year = Number(selected);
    this.dispatchEvent(new CustomEvent('ll-period-change', { bubbles: true, composed: true, detail: { month: this._month, year: this._year } }));
    this.render();
  }

  async openLanguagePicker() {
    const sheet = this.shadowRoot.getElementById('language-sheet');
    if (!sheet) return;
    const selected = await sheet.open({
      title: t('language'),
      items: [
        { value: 'en', label: t('language.en') },
        { value: 'es', label: t('language.es') },
        { value: 'pt-BR', label: t('language.pt-BR') },
      ],
      selectedValue: getActiveLang(),
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    if (!selected) return;
    this.dispatchEvent(new CustomEvent('ll-language-change', { bubbles: true, composed: true, detail: { lang: String(selected) } }));
  }

  async openThemePicker() {
    const sheet = this.shadowRoot.getElementById('theme-sheet');
    if (!sheet) return;
    const selected = await sheet.open({
      title: t('toggle.theme'),
      items: [
        { value: 'light', label: t('theme.light') },
        { value: 'dark', label: t('theme.dark') },
      ],
      selectedValue: this._theme || 'light',
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    if (!selected) return;
    const next = String(selected);
    if (next === this._theme) return;
    this.dispatchEvent(new CustomEvent('ll-theme-set', { bubbles: true, composed: true, detail: { theme: next } }));
  }

  async openUserMenu() {
    const sheet = this.shadowRoot.getElementById('user-sheet');
    if (!sheet) return;
    const selected = await sheet.open({
      title: t('menu'),
      items: [
        { value: 'vendors', label: t('vendors') },
        { value: 'expenseTypes', label: t('expense.types') },
        { value: 'currencies', label: t('menu.currencies') },
        { value: 'company', label: t('menu.company') },
        { value: '__preferences__', label: t('preferences'), kind: 'section' },
        { value: 'language', label: t('language') },
        { value: 'theme', label: t('toggle.theme') },
        { value: 'month', label: t('month') },
        { value: 'year', label: t('year') },
      ],
      selectedValue: null,
      searchable: false,
      layout: 'list',
      columns: 1,
    });
    if (!selected) return;
    if (selected === 'vendors') this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'vendors' } }));
    if (selected === 'expenseTypes') this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'expenseTypes' } }));
    if (selected === 'currencies') this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'currencies' } }));
    if (selected === 'company') this.dispatchEvent(new CustomEvent('ll-nav', { bubbles: true, composed: true, detail: { view: 'company' } }));
    if (selected === 'language') await this.openLanguagePicker();
    if (selected === 'theme') await this.openThemePicker();
    if (selected === 'month') await this.openMonthPicker();
    if (selected === 'year') await this.openYearPicker();
  }

  _displayUserName() {
    return this._userName || t('user.anonymous');
  }

  _computeIsMobile() {
    try {
      if (typeof window?.matchMedia === 'function') {
        return window.matchMedia('(max-width: 767px)').matches;
      }
      return Number(window?.innerWidth || 0) < 768;
    } catch {
      return false;
    }
  }

  _eventPathHasId(event, id) {
    try {
      const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
      if (path.some((node) => node instanceof HTMLElement && node.id === id)) return true;

      let node = event?.target;
      while (node) {
        if (node instanceof HTMLElement && node.id === id) return true;
        node = node.parentNode;
      }
      return false;
    } catch {
      return false;
    }
  }

  render() {
    const periodLabel = `${this._monthLabel()} ${this._year}`;
    const isMain = this._view === 'main';
    const companyName = this._companyName && this._companyName.trim() ? this._companyName.trim() : t('company.name');
    const companySubtitle =
      this._companySubtitle && this._companySubtitle.trim() ? this._companySubtitle.trim() : t('header.subtitle');
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <header class="app-header">
        <div class="app-header-inner">
          <div class="brand-block">
            <div class="brand-title">${companyName}</div>
            <div class="brand-subtitle">${companySubtitle}</div>
            <div class="brand-period" aria-label="${t('period')}">${periodLabel}</div>
          </div>
          <div class="header-right">
            <button class="icon-btn header-back" id="back-btn" type="button" aria-label="${t('back')}" title="${t('back')}" ${isMain ? 'hidden' : ''}>←</button>
            <button class="user-chip" id="user-btn" data-testid="header-user" type="button" aria-label="${t('user.menu')}" title="${t('user.menu')}">
              <span class="avatar" aria-hidden="true">${this._displayUserName().slice(0, 1).toUpperCase()}</span>
              ${this._isMobile ? '' : `<span class="user-name">${this._displayUserName()}</span>`}
            </button>
            <button class="icon-btn" id="export-btn" data-testid="header-export" type="button" title="${t('export.csv')}" aria-label="${t('export.csv')}" ${isMain ? '' : 'hidden'}>⤓</button>
          </div>
        </div>
      </header>
      <ui-bottom-sheet id="period-sheet"></ui-bottom-sheet>
      <ui-bottom-sheet id="language-sheet"></ui-bottom-sheet>
      <ui-bottom-sheet id="theme-sheet"></ui-bottom-sheet>
      <ui-bottom-sheet id="user-sheet"></ui-bottom-sheet>
    `;

    const userBtn = this.shadowRoot.getElementById('user-btn');
    if (userBtn) {
      userBtn.addEventListener('click', () => this.openUserMenu());
      userBtn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        this.openUserMenu();
      });
    }
  }

  updateThemeIcon(theme) {
    this._theme = theme === 'dark' ? 'dark' : 'light';
  }
}

customElements.define('ll-header', LlHeader);
