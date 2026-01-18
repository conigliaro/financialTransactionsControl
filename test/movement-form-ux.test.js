import { describe, it, expect } from 'vitest';

import '../components/ll-movement-form.js';

describe('<ll-movement-form> UX', () => {
  it('defaults txnType to income for new movements', async () => {
    document.body.innerHTML = '<ll-movement-form></ll-movement-form>';
    await customElements.whenDefined('ll-movement-form');
    const formEl = document.querySelector('ll-movement-form');

    formEl.show();

    const income = formEl.shadowRoot.getElementById('txnType-income');
    const expense = formEl.shadowRoot.getElementById('txnType-expense');
    expect(income).not.toBeNull();
    expect(expense).not.toBeNull();
    expect(income.checked).toBe(true);
    expect(expense.checked).toBe(false);
  });

  it('formats money inputs as cents-entry while typing digits', async () => {
    document.body.innerHTML = '<ll-movement-form></ll-movement-form>';
    await customElements.whenDefined('ll-movement-form');
    const formEl = document.querySelector('ll-movement-form');

    formEl.show();

    const docValue = formEl.shadowRoot.querySelector('#docValue');
    expect(docValue).not.toBeNull();

    docValue.focus();
    docValue.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(docValue.value).toBe('0.01');
    docValue.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(docValue.value).toBe('0.11');
    docValue.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(docValue.value).toBe('1.11');

    docValue.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(docValue.value).toBe('0.11');

    docValue.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(docValue.value).toBe('0.11');
  });

  it('keeps paidValue empty when cleared (so auto-calc can still apply)', async () => {
    document.body.innerHTML = '<ll-movement-form></ll-movement-form>';
    await customElements.whenDefined('ll-movement-form');
    const formEl = document.querySelector('ll-movement-form');

    formEl.show();

    const paidValue = formEl.shadowRoot.querySelector('#paidValue');
    expect(paidValue).not.toBeNull();

    paidValue.focus();
    paidValue.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    expect(paidValue.value).toBe('0.05');

    paidValue.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(paidValue.value).toBe('');
  });

  it('moves focus to the next field on Enter (except textarea)', async () => {
    document.body.innerHTML = '<ll-movement-form></ll-movement-form>';
    await customElements.whenDefined('ll-movement-form');
    const formEl = document.querySelector('ll-movement-form');

    formEl.show();

    const date = formEl.shadowRoot.querySelector('#date');
    const docValue = formEl.shadowRoot.querySelector('#docValue');

    date.focus();
    date.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(formEl.shadowRoot.activeElement).toBe(docValue);
  });
});
