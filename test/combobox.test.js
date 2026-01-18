import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n/loader.js', () => ({
  t: (key, repl = {}) => {
    if (key === 'create.item') return `Create "${repl.value}"`;
    if (key === 'combobox.no_matches') return 'No matches';
    if (key === 'clear') return 'Clear';
    return key;
  },
}));

import '../components/ui-combobox.js';
import '../components/ll-movement-form.js';

describe('<ui-combobox>', () => {
  it('shows create option when no exact match and emits ui-combobox-create', async () => {
    document.body.innerHTML = `
      <ui-combobox id="cb">
        <input class="combobox-input" id="x" />
      </ui-combobox>
    `;
    await customElements.whenDefined('ui-combobox');
    const cb = document.getElementById('cb');
    cb.setItems([{ name: 'Apple', normalizedName: 'apple' }]);

    const onCreate = vi.fn();
    cb.addEventListener('ui-combobox-create', onCreate);

    const input = document.getElementById('x');
    input.value = 'Ban';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const option0 = cb.shadowRoot.querySelector('.combobox-option[data-idx="0"]');
    expect(option0).not.toBeNull();
    option0.click();

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ detail: { value: 'Ban' } }));
    expect(input.value).toBe('Ban');
  });

  it('highlights matches inline without inserting spacing', async () => {
    document.body.innerHTML = `
      <ui-combobox id="cb">
        <input class="combobox-input" id="x" />
      </ui-combobox>
    `;
    await customElements.whenDefined('ui-combobox');
    const cb = document.getElementById('cb');
    cb.setItems([{ name: 'Acme' }, { name: 'America' }]);

    const input = document.getElementById('x');
    input.value = 'a';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const options = [...cb.shadowRoot.querySelectorAll('.combobox-option')];
    expect(options.length).toBeGreaterThan(1);

    const acme = options.find((opt) => opt.textContent === 'Acme');
    const america = options.find((opt) => opt.textContent === 'America');
    expect(acme).not.toBeUndefined();
    expect(america).not.toBeUndefined();

    const marks = cb.shadowRoot.querySelectorAll('mark.match');
    expect(marks.length).toBeGreaterThan(0);
  });
});

describe('<ll-movement-form> combobox integration', () => {
  it('dispatches ll-catalog-upsert when combobox create is selected', async () => {
    document.body.innerHTML = '<ll-movement-form></ll-movement-form>';
    await customElements.whenDefined('ll-movement-form');
    const formEl = document.querySelector('ll-movement-form');
    formEl.setCatalogOptions({ vendors: [{ name: 'Acme', normalizedName: 'acme' }], expenseTypes: [] });

    const onUpsert = vi.fn();
    formEl.addEventListener('ll-catalog-upsert', onUpsert);

    formEl.show();
    const vendorInput = formEl.shadowRoot.querySelector('#vendor');
    vendorInput.value = 'New Vendor';
    vendorInput.dispatchEvent(new Event('input', { bubbles: true }));

    const vendorCombo = formEl.shadowRoot.getElementById('vendor-combo');
    const createOption = vendorCombo.shadowRoot.querySelector('.combobox-option[data-idx="0"]');
    expect(createOption).not.toBeNull();
    createOption.click();

    expect(onUpsert).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: 'vendor', value: 'New Vendor' } }));
  });
});
