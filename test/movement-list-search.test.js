import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n/loader.js', () => ({
  getActiveLang: () => 'en',
  t: (key) => key,
}));

import '../components/ll-movement-list.js';

describe('<ll-movement-list> search UX', () => {
  it('filters across fields, highlights matches, and clears', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<ll-movement-list></ll-movement-list>';
    await customElements.whenDefined('ll-movement-list');
    const list = document.querySelector('ll-movement-list');

    list.setMovements([
      {
        id: 'm1',
        date: '2025-01-01',
        vendor: 'TipTop',
        expenseType: 'Food',
        docValue: 111,
        interest: 0,
        discount: 0,
        paidValue: 111,
        notes: 'some notes',
        status: 'draft',
      },
      {
        id: 'm2',
        date: '2025-01-02',
        vendor: 'Other',
        expenseType: 'Rent',
        docValue: 5,
        interest: 0,
        discount: 0,
        paidValue: 5,
        notes: '',
        status: 'draft',
      },
    ]);

    expect(list.shadowRoot.textContent).not.toContain('filter.by_expense_type');

    const input = list.shadowRoot.querySelector('#search-filter');
    expect(input).not.toBeNull();
    input.value = 'tip';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(130);

    const cards = list.shadowRoot.querySelectorAll('.movement-card');
    expect(cards.length).toBe(1);
    expect(cards[0].dataset.id).toBe('m1');

    const mark = list.shadowRoot.querySelector('mark.match');
    expect(mark).not.toBeNull();
    expect(mark.textContent.toLowerCase()).toBe('tip');

    expect(list.shadowRoot.querySelector('#search-clear')).toBeNull();

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(1);
    expect(input.value).toBe('');
    expect(list.shadowRoot.querySelectorAll('.movement-card').length).toBe(2);

    vi.useRealTimers();
  });

  it('shows a localized empty state when no matches', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<ll-movement-list></ll-movement-list>';
    await customElements.whenDefined('ll-movement-list');
    const list = document.querySelector('ll-movement-list');

    list.setMovements([
      {
        id: 'm1',
        date: '2025-01-01',
        vendor: 'TipTop',
        expenseType: 'Food',
        docValue: 111,
        interest: 0,
        discount: 0,
        paidValue: 111,
        notes: '',
        status: 'draft',
      },
    ]);

    const input = list.shadowRoot.querySelector('#search-filter');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(130);

    const empty = list.shadowRoot.querySelector('ui-empty-state');
    expect(empty).not.toBeNull();
    expect(empty.querySelector('[slot="heading"]')).toHaveTextContent('no.matches.title');

    vi.useRealTimers();
  });
});
