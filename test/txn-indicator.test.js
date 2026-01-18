import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n/loader.js', () => ({
  getActiveLang: () => 'en',
  t: (key) => key,
}));

import '../components/ll-movement-list.js';

describe('Transaction type indicator', () => {
  it('renders green/red sign classes for income/expense', async () => {
    document.body.innerHTML = '<ll-movement-list></ll-movement-list>';
    await customElements.whenDefined('ll-movement-list');
    const list = document.querySelector('ll-movement-list');

    list.setMovements([
      {
        id: 'm1',
        txnType: 'income',
        date: '2025-01-01',
        vendor: 'Acme',
        expenseType: 'Salary',
        docValue: 10,
        interest: 0,
        discount: 0,
        paidValue: 10,
        notes: '',
        status: 'draft',
      },
      {
        id: 'm2',
        txnType: 'expense',
        date: '2025-01-02',
        vendor: 'Store',
        expenseType: 'Food',
        docValue: 5,
        interest: 0,
        discount: 0,
        paidValue: 5,
        notes: '',
        status: 'draft',
      },
    ]);

    const signs = list.shadowRoot.querySelectorAll('.txn-sign');
    expect(signs.length).toBeGreaterThan(1);

    const incomeSign = list.shadowRoot.querySelector('.txn-sign--income');
    const expenseSign = list.shadowRoot.querySelector('.txn-sign--expense');
    expect(incomeSign).not.toBeNull();
    expect(expenseSign).not.toBeNull();
    expect(incomeSign.textContent).toBe('+');
    expect(expenseSign.textContent).toBe('−');

    const sr = list.shadowRoot.querySelector('.txn-value .visually-hidden');
    expect(sr).not.toBeNull();
  });
});

