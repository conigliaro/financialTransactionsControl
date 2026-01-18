import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/dom';

// Import components to register them
import '../components/ll-app.js';
import '../components/ui-toast.js';
import '../components/ui-dialog.js';
import '../components/ll-movement-list.js';
import '../components/ui-bottom-sheet.js';

// Mocks
vi.mock('../i18n/loader.js', () => ({
  loadTranslations: vi.fn(),
  setLanguage: vi.fn(),
  getActiveLang: () => 'en',
  t: (key) => key,
}));
vi.mock('../db/indexeddb.js', () => ({
    db: {
        open: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
    }
}));


describe('Web Components', () => {

  describe('<ll-app>', () => {
    it('should render the main layout', async () => {
      document.body.innerHTML = '<ll-app></ll-app>';
      await customElements.whenDefined('ll-app');
      const app = document.querySelector('ll-app');
      expect(app.shadowRoot.querySelector('ll-header')).not.toBeNull();
      expect(app.shadowRoot.querySelector('ll-movement-list')).not.toBeNull();
    });
  });
  
  describe('<ll-movement-list>', () => {
    it('should render an empty state when no movements are provided', async () => {
      document.body.innerHTML = '<ll-movement-list></ll-movement-list>';
      await customElements.whenDefined('ll-movement-list');
      const list = document.querySelector('ll-movement-list');
      list.setMovements([]);
      
      const emptyState = list.shadowRoot.querySelector('ui-empty-state');
      expect(emptyState).not.toBeNull();
      expect(emptyState).toHaveTextContent('no.movements.title');
    });
  });

  describe('<ui-toast>', () => {
    it('should show and auto-dismiss a toast notification', async () => {
      vi.useFakeTimers();
      const { showToast } = await import('../components/ui-toast.js');
      showToast('Test message', { duration: 1000 });
      
      let toast = document.querySelector('ui-toast');
      expect(toast).not.toBeNull();
      expect(toast).toHaveTextContent('Test message');
      
      vi.runAllTimers();
      
      // After timers, the toast should have been removed
      toast = document.querySelector('ui-toast');
      expect(toast).toBeNull();
      vi.useRealTimers();
    });
  });

describe('<ui-dialog>', () => {
  it('should resolve with true on confirm', async () => {
    const { dialog } = await import('../components/ui-dialog.js');
      
      const promise = dialog.confirm({ title: 'Test', message: 'Test' });
      
      // Need to wait a tick for the dialog to render
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const confirmBtn = dialog.shadowRoot.querySelector('#confirm-btn');
      fireEvent.click(confirmBtn);
      
      await expect(promise).resolves.toBe(true);
    });

  it('should resolve with false on cancel', async () => {
    const { dialog } = await import('../components/ui-dialog.js');

    const promise = dialog.confirm({ title: 'Test', message: 'Test' });
    
    await new Promise(resolve => setTimeout(resolve, 0));

    const cancelBtn = dialog.shadowRoot.querySelector('#cancel-btn');
    fireEvent.click(cancelBtn);

    await expect(promise).resolves.toBe(false);
  });
});

describe('FinancieApp interactions', () => {
  let FinancieApp;

  beforeAll(async () => {
    const module = await import('../financie-app.js');
    FinancieApp = module.FinancieApp;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the movement form when the header add button is clicked', async () => {
    const app = new FinancieApp();
    await app.init();

    const fab = app.appRoot.shadowRoot.querySelector('#fab-add-movement');
    fireEvent.click(fab);

    const movementForm = app.appRoot.shadowRoot.querySelector('ll-movement-form');
    expect(movementForm.classList.contains('visible')).toBe(true);
    expect(movementForm.style.display).toBe('flex');
  });

  it('renders the FAB as fixed-position control', async () => {
    const app = new FinancieApp();
    await app.init();
    const fab = app.appRoot.shadowRoot.querySelector('#fab-add-movement');
    expect(fab).not.toBeNull();
    expect(fab.classList.contains('fab-fixed')).toBe(true);
  });
});

describe('<ui-bottom-sheet>', () => {
  it('does not render search input when searchable is false', async () => {
    document.body.innerHTML = '<ui-bottom-sheet></ui-bottom-sheet>';
    await customElements.whenDefined('ui-bottom-sheet');
    const sheet = document.querySelector('ui-bottom-sheet');

    const promise = sheet.open({
      title: 'month',
      items: [{ value: 1, label: 'Jan' }],
      selectedValue: 1,
      searchable: false,
      layout: 'list',
      columns: 1,
    });

    expect(sheet.shadowRoot.querySelector('#sheet-search')).toBeNull();
    sheet.cancel();
    await expect(promise).resolves.toBeNull();
  });

  it('forces list layout on small viewports even if grid is requested', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });

    document.body.innerHTML = '<ui-bottom-sheet></ui-bottom-sheet>';
    await customElements.whenDefined('ui-bottom-sheet');
    const sheet = document.querySelector('ui-bottom-sheet');

    const promise = sheet.open({
      title: 'month',
      items: [
        { value: 1, label: 'Jan' },
        { value: 2, label: 'Feb' },
      ],
      selectedValue: 1,
      searchable: false,
      layout: 'grid',
      columns: 3,
    });

    const list = sheet.shadowRoot.querySelector('.sheet-list');
    expect(list).not.toBeNull();
    expect(list.classList.contains('sheet-list--grid')).toBe(false);

    sheet.cancel();
    await expect(promise).resolves.toBeNull();

    window.matchMedia = originalMatchMedia;
  });
});

});
