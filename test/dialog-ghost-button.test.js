import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => {
    const map = { cancel: 'Cancel', delete: 'Delete' };
    return map[key] || key;
  },
}));

import { dialog } from '../components/ui-dialog.js';

describe('ui-dialog confirm footer actions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.appendChild(dialog);
    dialog.style.display = 'none';
  });

  it('renders exactly two action buttons (Cancel + Delete) with no empty/ghost button', async () => {
    const p = dialog.confirm({
      title: 'Confirm',
      message: 'Delete?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });

    expect(dialog.style.display).toBe('flex');

    const footer = dialog.shadowRoot.querySelector('.modal-footer');
    const buttons = Array.from(footer.querySelectorAll('button')).filter((b) => !b.hidden);

    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent.trim()).toBe('Cancel');
    expect(buttons[1].textContent.trim()).toBe('Delete');
    expect(buttons.every((b) => b.textContent.trim().length > 0)).toBe(true);

    dialog.shadowRoot.getElementById('cancel-btn').click();
    await expect(p).resolves.toBe(false);
  });
});

