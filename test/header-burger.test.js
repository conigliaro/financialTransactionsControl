import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n/loader.js', () => ({
  getActiveLang: () => 'en',
  t: (key) => key,
}));

import '../components/ll-header.js';

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('<ll-header> responsive header controls', () => {
  it('desktop: renders only user pill (with name) + export; no burger/language/theme/month/year buttons', async () => {
    setViewportWidth(1024);
    document.body.innerHTML = '<ll-header></ll-header>';
    await customElements.whenDefined('ll-header');
    const header = document.querySelector('ll-header');

    expect(header.shadowRoot.querySelector('#burger-btn')).toBeNull();
    expect(header.shadowRoot.querySelector('#language-button')).toBeNull();
    expect(header.shadowRoot.querySelector('#theme-toggle')).toBeNull();
    expect(header.shadowRoot.querySelector('#month-button')).toBeNull();
    expect(header.shadowRoot.querySelector('#year-button')).toBeNull();

    const userBtn = header.shadowRoot.querySelector('#user-btn');
    expect(userBtn).not.toBeNull();
    expect(userBtn.querySelector('.user-name')).not.toBeNull();

    const exportBtn = header.shadowRoot.querySelector('#export-btn');
    expect(exportBtn).not.toBeNull();

    const right = header.shadowRoot.querySelector('.header-right');
    const visibleButtons = [...right.querySelectorAll('button')].filter((btn) => !btn.hasAttribute('hidden'));
    const ids = visibleButtons.map((b) => b.id).filter(Boolean);
    expect(ids).toEqual(['user-btn', 'export-btn']);
  });

  it('mobile: renders avatar icon only (no username) + export; no burger/language/theme/month/year buttons', async () => {
    setViewportWidth(375);
    document.body.innerHTML = '<ll-header></ll-header>';
    await customElements.whenDefined('ll-header');
    const header = document.querySelector('ll-header');

    expect(header.shadowRoot.querySelector('#burger-btn')).toBeNull();
    expect(header.shadowRoot.querySelector('#language-button')).toBeNull();
    expect(header.shadowRoot.querySelector('#theme-toggle')).toBeNull();
    expect(header.shadowRoot.querySelector('#month-button')).toBeNull();
    expect(header.shadowRoot.querySelector('#year-button')).toBeNull();

    const userBtn = header.shadowRoot.querySelector('#user-btn');
    expect(userBtn).not.toBeNull();
    expect(userBtn.querySelector('.user-name')).toBeNull();
    expect(userBtn.querySelector('.avatar')).not.toBeNull();

    const exportBtn = header.shadowRoot.querySelector('#export-btn');
    expect(exportBtn).not.toBeNull();
  });
});

describe('<ll-header> avatar menu click target', () => {
  it('opens user menu when clicking avatar, name, or pill; still works after view changes', async () => {
    setViewportWidth(1024);
    document.body.innerHTML = '<ll-header></ll-header>';
    await customElements.whenDefined('ll-header');
    const header = document.querySelector('ll-header');

    const spy = vi.spyOn(header, 'openUserMenu');

    const userBtn = header.shadowRoot.querySelector('#user-btn');
    const avatar = header.shadowRoot.querySelector('#user-btn .avatar');
    const name = header.shadowRoot.querySelector('#user-btn .user-name');

    expect(userBtn).not.toBeNull();
    expect(avatar).not.toBeNull();
    expect(name).not.toBeNull();

    const assertOpens = async (el) => {
      const before = spy.mock.calls.length;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(spy.mock.calls.length).toBe(before + 1);
    };

    await assertOpens(avatar);
    await assertOpens(name);
    await assertOpens(userBtn);

    header.setView('vendors');
    header.setView('main');

    await assertOpens(userBtn);
  });

  it('opens user menu on Enter/Space when focused on avatar pill', async () => {
    setViewportWidth(1024);
    document.body.innerHTML = '<ll-header></ll-header>';
    await customElements.whenDefined('ll-header');
    const header = document.querySelector('ll-header');

    const userBtn = header.shadowRoot.querySelector('#user-btn');
    const sheet = header.shadowRoot.getElementById('user-sheet');
    expect(userBtn).not.toBeNull();
    expect(sheet).not.toBeNull();

    userBtn.focus();
    userBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(sheet.style.display).toBe('block');
    sheet.cancel?.();

    userBtn.focus();
    userBtn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(sheet.style.display).toBe('block');
  });
});

describe('<ll-header> user menu contents', () => {
  it('includes vendors, expense types, and preferences items', async () => {
    setViewportWidth(1024);
    document.body.innerHTML = '<ll-header></ll-header>';
    await customElements.whenDefined('ll-header');
    const header = document.querySelector('ll-header');

    const userBtn = header.shadowRoot.querySelector('#user-btn');
    const sheet = header.shadowRoot.getElementById('user-sheet');
    expect(userBtn).not.toBeNull();
    expect(sheet).not.toBeNull();
    expect(sheet.style.display).toBe('none');

    userBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sheet.style.display).toBe('block');

    const labels = [...sheet.shadowRoot.querySelectorAll('.sheet-item-label, .sheet-section')].map((n) =>
      String(n.textContent || '').trim()
    );
    expect(labels).toContain('vendors');
    expect(labels).toContain('expense.types');
    expect(labels).toContain('menu.currencies');
    expect(labels).toContain('menu.company');
    expect(labels).toContain('preferences');
    expect(labels).toContain('language');
    expect(labels).toContain('toggle.theme');
    expect(labels).toContain('month');
    expect(labels).toContain('year');
  });
});
