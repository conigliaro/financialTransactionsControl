import { t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';
import { lockBodyScroll, unlockBodyScroll } from './ui-scroll-lock.js';
import './ui-combobox.js';
import { registerModal, unregisterModal } from './ui-dialog.js';

class LlMovementForm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.editingMovementId = null;
    this.editingMovementStatus = null;
    this._moneyDigitsById = new Map();
    this._catalogVendors = [];
    this._catalogExpenseTypes = [];
    this._saving = false;
    this._lastSaveRequestAt = 0;
    this._modalToken = null;
    this._restoreFocusEl = null;
    this._onI18nUpdated = () => {
      if (this.classList.contains('visible')) {
        this._updateStaticTexts();
      } else {
        this.render();
      }
    };
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.render();
    this.style.display = 'none';
    this.shadowRoot.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.shadowRoot.addEventListener('input', (e) => this._onInput(e));
    this.shadowRoot.addEventListener('focusin', (e) => this._onFocusIn(e));
    this.shadowRoot.addEventListener('blur', (e) => this._onBlur(e), true);
    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target?.classList?.contains('overlay')) this._requestCancel();
      if (e.target?.closest?.('#close-btn')) this._requestCancel();
      if (e.target?.closest?.('#cancel-btn')) this._requestCancel();
      if (e.target?.closest?.('#save-btn')) this._requestSave();
    });
    // iOS Safari reliability: treat pointer/touch activation as primary.
    this.shadowRoot.addEventListener('pointerup', (e) => {
      if (e.target?.closest?.('#save-btn')) {
        e.preventDefault();
        this._requestSave();
      }
      if (e.target?.closest?.('#cancel-btn') || e.target?.closest?.('#close-btn')) {
        e.preventDefault();
        this._requestCancel();
      }
    });
    this.shadowRoot.addEventListener(
      'touchend',
      (e) => {
        if (e.target?.closest?.('#save-btn')) {
          e.preventDefault();
          this._requestSave();
        }
        if (e.target?.closest?.('#cancel-btn') || e.target?.closest?.('#close-btn')) {
          e.preventDefault();
          this._requestCancel();
        }
      },
      { capture: true }
    );
    this.shadowRoot.addEventListener('ui-combobox-create', (e) => {
      const combo = e.target;
      if (!(combo instanceof HTMLElement)) return;
      const kind = combo.getAttribute('data-kind');
      const value = e.detail?.value;
      if (!kind || !value) return;
      this.dispatchEvent(new CustomEvent('ll-catalog-upsert', { bubbles: true, composed: true, detail: { kind, value: String(value) } }));
    });
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="overlay" role="presentation">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
          <div class="modal-header">
            <h2 class="modal-title" id="form-title">${this.editingMovementId ? t('edit.movement') : t('add.movement')}</h2>
            <button type="button" class="icon-btn" id="close-btn" aria-label="${t('close')}" title="${t('close')}">✕</button>
          </div>
          <div class="modal-body">
            <form class="form-grid">
              <div class="full-width">
                <span class="field-label" id="txnType-label">${t('transaction.type')}</span>
                <div class="segmented" role="radiogroup" aria-labelledby="txnType-label">
                  <input type="radio" id="txnType-income" name="txnType" value="income" checked />
                  <label for="txnType-income">${t('transaction.type.income')}</label>
                  <input type="radio" id="txnType-expense" name="txnType" value="expense" />
                  <label for="txnType-expense">${t('transaction.type.expense')}</label>
                </div>
              </div>
              <div>
                <label for="date">${t('date')}</label>
                <input type="date" id="date" name="date" required>
              </div>
              <div>
                <label for="docValue">${t('doc.value')}</label>
                <input type="text" inputmode="numeric" id="docValue" name="docValue" placeholder="0.00" required autocomplete="off" data-money="true">
              </div>
              <div>
                <label for="paidValue">${t('paid.value')}</label>
                <input type="text" inputmode="numeric" id="paidValue" name="paidValue" placeholder="0.00" autocomplete="off" data-money="true">
              </div>
              <div>
                <label for="interest">${t('interest')}</label>
                <input type="text" inputmode="numeric" id="interest" name="interest" placeholder="0.00" autocomplete="off" data-money="true">
              </div>
              <div>
                <label for="discount">${t('discount')}</label>
                <input type="text" inputmode="numeric" id="discount" name="discount" placeholder="0.00" autocomplete="off" data-money="true">
              </div>
              <div>
                <label for="expenseType">${t('expense.type')}</label>
                <ui-combobox id="expenseType-combo" data-kind="expenseType">
                  <input class="combobox-input" type="text" id="expenseType" name="expenseType" required placeholder="${t('placeholder.expense_type')}" aria-label="${t('select.expense_type')}" autocomplete="off">
                </ui-combobox>
              </div>
              <div>
                <label for="vendor">${t('vendor')}</label>
                <ui-combobox id="vendor-combo" data-kind="vendor">
                  <input class="combobox-input" type="text" id="vendor" name="vendor" required placeholder="${t('placeholder.vendor')}" aria-label="${t('select.vendor')}" autocomplete="off">
                </ui-combobox>
              </div>
              <div class="full-width">
                <label for="notes">${t('notes')}</label>
                <textarea id="notes" name="notes" placeholder="${t('placeholder.notes')}"></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" id="cancel-btn" class="btn secondary" ${this._saving ? 'disabled' : ''}>${t('cancel')}</button>
            <button type="button" id="save-btn" class="btn primary" ${this._saving ? 'disabled' : ''}>${t('save')}</button>
          </div>
        </div>
      </div>
    `;
  }

  setCatalogOptions({ vendors, expenseTypes }) {
    if (Array.isArray(vendors)) this._catalogVendors = vendors;
    if (Array.isArray(expenseTypes)) this._catalogExpenseTypes = expenseTypes;

    const vendorCombo = this.shadowRoot.getElementById('vendor-combo');
    vendorCombo?.setItems?.(this._catalogVendors);
    const expenseCombo = this.shadowRoot.getElementById('expenseType-combo');
    expenseCombo?.setItems?.(this._catalogExpenseTypes);
  }

  show() {
    this._restoreFocusEl = document.activeElement;
    this.style.display = 'flex';
    this.classList.add('visible');
    lockBodyScroll();
    this._modalToken = registerModal({ close: () => this._requestCancel(), restoreFocusEl: this._restoreFocusEl });
    this.setSaving(false);
    this._updateTitle();
    // Set today's date by default on new entries
    const dateInput = this.shadowRoot.querySelector('#date');
    if (!this.editingMovementId && dateInput) {
        dateInput.valueAsDate = new Date();
    }
    if (!this.editingMovementId) {
      const incomeRadio = this.shadowRoot.getElementById('txnType-income');
      const expenseRadio = this.shadowRoot.getElementById('txnType-expense');
      if (incomeRadio && expenseRadio) {
        incomeRadio.checked = true;
        expenseRadio.checked = false;
      }
    }
    queueMicrotask(() => this.shadowRoot.querySelector('#date')?.focus());
  }

  edit(movement) {
    if (!movement) return;
    this.editingMovementId = String(movement.id);
    this.editingMovementStatus = movement.status ?? 'draft';
    this.show();

    const txn = movement.txnType === 'income' ? 'income' : 'expense';
    const incomeRadio = this.shadowRoot.getElementById('txnType-income');
    const expenseRadio = this.shadowRoot.getElementById('txnType-expense');
    if (incomeRadio && expenseRadio) {
      incomeRadio.checked = txn === 'income';
      expenseRadio.checked = txn === 'expense';
    }

    const dateInput = this.shadowRoot.querySelector('#date');
    if (dateInput) dateInput.value = movement.date ?? '';
    const docValue = this.shadowRoot.querySelector('#docValue');
    if (docValue) this._setMoneyFromNumber(docValue, movement.docValue);
    const interest = this.shadowRoot.querySelector('#interest');
    if (interest) this._setMoneyFromNumber(interest, movement.interest);
    const discount = this.shadowRoot.querySelector('#discount');
    if (discount) this._setMoneyFromNumber(discount, movement.discount);
    const paidValue = this.shadowRoot.querySelector('#paidValue');
    if (paidValue) this._setMoneyFromNumber(paidValue, movement.paidValue, { keepEmpty: true });
    const expenseType = this.shadowRoot.querySelector('#expenseType');
    if (expenseType) expenseType.value = movement.expenseType ?? '';
    const vendor = this.shadowRoot.querySelector('#vendor');
    if (vendor) vendor.value = movement.vendor ?? '';
    const notes = this.shadowRoot.querySelector('#notes');
    if (notes) notes.value = movement.notes ?? '';
  }

  hide() {
    if (this.style.display === 'none') return;
    this.classList.remove('visible');
    this.style.display = 'none';
    unlockBodyScroll();
    if (this._modalToken) {
      const token = this._modalToken;
      this._modalToken = null;
      unregisterModal(token);
    }
    this.setSaving(false);
    this.shadowRoot.querySelector('form').reset();
    this.editingMovementId = null;
    this.editingMovementStatus = null;
    this._moneyDigitsById.clear();
    this._updateTitle();
  }

  _updateTitle() {
    const title = this.shadowRoot.getElementById('form-title');
    if (!title) return;
    title.textContent = this.editingMovementId ? t('edit.movement') : t('add.movement');
  }

  _updateStaticTexts() {
    this._updateTitle();
    const close = this.shadowRoot.getElementById('close-btn');
    if (close) {
      close.setAttribute('aria-label', t('close'));
      close.setAttribute('title', t('close'));
    }
    const cancel = this.shadowRoot.getElementById('cancel-btn');
    if (cancel) cancel.textContent = t('cancel');
    const save = this.shadowRoot.getElementById('save-btn');
    if (save) save.textContent = t('save');

    const labels = [
      ['txnType-income', 'transaction.type.income'],
      ['txnType-expense', 'transaction.type.expense'],
      ['date', 'date'],
      ['docValue', 'doc.value'],
      ['paidValue', 'paid.value'],
      ['interest', 'interest'],
      ['discount', 'discount'],
      ['expenseType', 'expense.type'],
      ['vendor', 'vendor'],
      ['notes', 'notes'],
    ];
    for (const [forId, key] of labels) {
      const label = this.shadowRoot.querySelector(`label[for="${forId}"]`);
      if (label) label.textContent = t(key);
    }

    const txnLabel = this.shadowRoot.getElementById('txnType-label');
    if (txnLabel) txnLabel.textContent = t('transaction.type');

    const expenseType = this.shadowRoot.getElementById('expenseType');
    if (expenseType) {
      expenseType.setAttribute('placeholder', t('placeholder.expense_type'));
      expenseType.setAttribute('aria-label', t('select.expense_type'));
    }
    const vendor = this.shadowRoot.getElementById('vendor');
    if (vendor) {
      vendor.setAttribute('placeholder', t('placeholder.vendor'));
      vendor.setAttribute('aria-label', t('select.vendor'));
    }
    const notes = this.shadowRoot.getElementById('notes');
    if (notes) notes.setAttribute('placeholder', t('placeholder.notes'));
  }

  _requestCancel() {
    this.hide();
    this.dispatchEvent(new CustomEvent('ll-movement-cancel', { bubbles: true, composed: true }));
  }

  _requestSave() {
    if (this._saving) return;
    const now = Date.now();
    if (now - this._lastSaveRequestAt < 450) return;
    this._lastSaveRequestAt = now;

    const form = this.shadowRoot.querySelector('form');
    if (!form) return;

    if (!form.checkValidity()) {
      if (typeof form.reportValidity === 'function') {
        form.reportValidity();
        return;
      }

      const firstInvalid = form.querySelector(':invalid');
      firstInvalid?.focus?.();
      return;
    }

    this.setSaving(true);
    this.dispatchEvent(new CustomEvent('ll-movement-save', { bubbles: true, composed: true, detail: { form } }));
  }

  setSaving(saving) {
    this._saving = Boolean(saving);
    const save = this.shadowRoot.getElementById('save-btn');
    const cancel = this.shadowRoot.getElementById('cancel-btn');
    const close = this.shadowRoot.getElementById('close-btn');
    if (save) save.toggleAttribute('disabled', this._saving);
    if (cancel) cancel.toggleAttribute('disabled', this._saving);
    if (close) close.toggleAttribute('disabled', this._saving);
    const modal = this.shadowRoot.querySelector('.modal');
    if (modal) modal.toggleAttribute('aria-busy', this._saving);
  }

  _isMoneyInput(el) {
    return el instanceof HTMLInputElement && el.getAttribute('data-money') === 'true';
  }

  _moneyConfigFor(input) {
    if (!input?.id) return { keepEmpty: true };
    if (input.id === 'docValue') return { keepEmpty: false };
    if (input.id === 'paidValue') return { keepEmpty: true };
    if (input.id === 'interest') return { keepEmpty: true };
    if (input.id === 'discount') return { keepEmpty: true };
    return { keepEmpty: true };
  }

  _digitsOnly(s) {
    return String(s || '').replace(/\D/g, '');
  }

  _formatCentsFromDigits(rawDigits) {
    const digits = rawDigits ? String(rawDigits) : '';
    const n = digits ? Number(digits) : 0;
    if (!Number.isFinite(n)) return '0.00';
    return (n / 100).toFixed(2);
  }

  _setValueAndCaretEnd(input, nextValue) {
    input.value = nextValue;
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {
      // no-op
    }
  }

  _setMoneyFromNumber(input, value, { keepEmpty } = {}) {
    const cfg = { ...this._moneyConfigFor(input), ...(keepEmpty == null ? {} : { keepEmpty }) };
    if (value == null || value === '') {
      this._moneyDigitsById.set(input.id, '');
      if (!cfg.keepEmpty) this._setValueAndCaretEnd(input, '0.00');
      else input.value = '';
      return;
    }
    const numeric = Number(value);
    const cents = Math.round((Number.isFinite(numeric) ? numeric : 0) * 100);
    const rawDigits = String(Math.max(0, cents));
    this._moneyDigitsById.set(input.id, rawDigits);
    this._setValueAndCaretEnd(input, this._formatCentsFromDigits(rawDigits));
  }

  _onFocusIn(e) {
    const target = e.target;
    if (!this._isMoneyInput(target)) return;
    queueMicrotask(() => {
      try {
        target.setSelectionRange(target.value.length, target.value.length);
      } catch {
        // no-op
      }
    });
  }

  _onBlur(e) {
    const target = e.target;
    if (!this._isMoneyInput(target)) return;
    const cfg = this._moneyConfigFor(target);
    const raw = this._moneyDigitsById.get(target.id) ?? this._digitsOnly(target.value);
    if (!raw) {
      if (!cfg.keepEmpty) this._setValueAndCaretEnd(target, '0.00');
      else target.value = '';
      this._moneyDigitsById.set(target.id, '');
      return;
    }
    this._moneyDigitsById.set(target.id, raw);
    this._setValueAndCaretEnd(target, this._formatCentsFromDigits(raw));
  }

  _onInput(e) {
    const target = e.target;
    if (!this._isMoneyInput(target)) return;
    const cfg = this._moneyConfigFor(target);
    const raw = this._digitsOnly(target.value);
    this._moneyDigitsById.set(target.id, raw);
    if (!raw && cfg.keepEmpty) {
      target.value = '';
      return;
    }
    this._setValueAndCaretEnd(target, this._formatCentsFromDigits(raw));
  }

  _onKeyDown(e) {
    const target = e.target;

    if (e.key === 'Enter' && !(target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      this._focusNextField(target);
      return;
    }

    if (!this._isMoneyInput(target)) return;

    const cfg = this._moneyConfigFor(target);
    const isDigit = e.key.length === 1 && e.key >= '0' && e.key <= '9';

    if (isDigit) {
      e.preventDefault();
      const prev = this._moneyDigitsById.get(target.id) ?? this._digitsOnly(target.value);
      const nextDigits = `${prev}${e.key}`.replace(/^0+(?=\d)/, '');
      this._moneyDigitsById.set(target.id, nextDigits);
      this._setValueAndCaretEnd(target, this._formatCentsFromDigits(nextDigits));
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      const prev = this._moneyDigitsById.get(target.id) ?? this._digitsOnly(target.value);
      const nextDigits = prev.slice(0, -1);
      this._moneyDigitsById.set(target.id, nextDigits);
      if (!nextDigits && cfg.keepEmpty) {
        target.value = '';
        return;
      }
      this._setValueAndCaretEnd(target, this._formatCentsFromDigits(nextDigits));
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      this._moneyDigitsById.set(target.id, '');
      if (cfg.keepEmpty) target.value = '';
      else this._setValueAndCaretEnd(target, '0.00');
      return;
    }

    const allowed = [
      'Tab',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
    ];
    if (allowed.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;

    // Block non-digit characters (including ".", ",", "e", "-", etc.)
    e.preventDefault();
  }

  _focusNextField(current) {
    const selectors = [
      '#txnType-income',
      '#date',
      '#docValue',
      '#paidValue',
      '#interest',
      '#discount',
      '#expenseType',
      '#vendor',
      '#notes',
    ];
    const fields = selectors
      .map((sel) => this.shadowRoot.querySelector(sel))
      .filter((el) => el && !el.disabled);
    const idx = fields.indexOf(current);
    if (idx < 0) return;
    const next = fields[idx + 1];
    if (!next) return;
    next.focus();
    if (next instanceof HTMLInputElement) {
      try {
        next.setSelectionRange(next.value.length, next.value.length);
      } catch {
        // no-op
      }
    }
  }
}

customElements.define('ll-movement-form', LlMovementForm);
