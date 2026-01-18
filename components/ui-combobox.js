import { t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';

function normalizeDisplay(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return normalizeDisplay(value).toLowerCase();
}

function renderHighlightedText(text, query) {
  const frag = document.createDocumentFragment();
  const q = String(query || '').trim();
  const full = String(text ?? '');
  if (!q) {
    frag.appendChild(document.createTextNode(full));
    return frag;
  }

  const lowerText = full.toLowerCase();
  const lowerQuery = q.toLowerCase();
  let idx = 0;
  while (idx < full.length) {
    const hit = lowerText.indexOf(lowerQuery, idx);
    if (hit === -1) {
      frag.appendChild(document.createTextNode(full.slice(idx)));
      break;
    }
    if (hit > idx) frag.appendChild(document.createTextNode(full.slice(idx, hit)));
    const mark = document.createElement('mark');
    mark.className = 'match';
    mark.textContent = full.slice(hit, hit + lowerQuery.length);
    frag.appendChild(mark);
    idx = hit + lowerQuery.length;
  }
  return frag;
}

export class UiCombobox extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._open = false;
    this._activeIndex = -1;
    this._onOutsidePointerDown = (e) => {
      const path = e.composedPath?.() || [];
      if (path.includes(this)) return;
      this.close();
    };
    this._onI18nUpdated = () => this.render();
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.render();

    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target?.id === 'clear-btn') {
        this._clear();
        return;
      }
      const option = e.target.closest('[data-idx]');
      if (option) {
        const idx = Number(option.getAttribute('data-idx'));
        this._selectByIndex(idx);
      }
    });
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
    this._removeOutsideListener();
  }

  setItems(items) {
    this._items = Array.isArray(items) ? items : [];
    this._renderList();
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="combobox">
        <slot></slot>
        <button class="combobox-clear" id="clear-btn" type="button" aria-label="${t('clear')}" title="${t('clear')}" hidden>✕</button>
        <div class="combobox-popover card" id="popover" role="listbox" hidden></div>
      </div>
    `;
    this._wireInput();
    this._renderList();
    this._syncClearButton();
  }

  _getInput() {
    const slot = this.shadowRoot.querySelector('slot');
    const assigned = slot?.assignedElements?.({ flatten: true }) || [];
    const input = assigned.find((el) => el instanceof HTMLInputElement);
    return input || null;
  }

  _wireInput() {
    const input = this._getInput();
    if (!input) return;

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', this._open ? 'true' : 'false');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('inputmode', input.getAttribute('inputmode') || 'text');

    if (!input.__comboboxWired) {
      input.addEventListener('input', () => {
        this.open();
        this._syncClearButton();
        this._renderList();
      });
      input.addEventListener('focus', () => {
        this.open();
        this._syncClearButton();
        this._renderList();
      });
      input.addEventListener('keydown', (e) => this._onKeyDown(e));
      input.__comboboxWired = true;
    }
  }

  open() {
    if (this._open) return;
    this._open = true;
    this._activeIndex = -1;
    this._setPopoverHidden(false);
    this._addOutsideListener();
    this._syncAriaExpanded();
    this._renderList();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this._activeIndex = -1;
    this._setPopoverHidden(true);
    this._removeOutsideListener();
    this._syncAriaExpanded();
  }

  _addOutsideListener() {
    window.addEventListener('pointerdown', this._onOutsidePointerDown, { capture: true });
  }

  _removeOutsideListener() {
    window.removeEventListener('pointerdown', this._onOutsidePointerDown, { capture: true });
  }

  _setPopoverHidden(hidden) {
    const popover = this.shadowRoot.getElementById('popover');
    const input = this._getInput();
    if (popover) popover.hidden = hidden;
    if (input) input.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  }

  _syncAriaExpanded() {
    const input = this._getInput();
    if (!input) return;
    input.setAttribute('aria-expanded', this._open ? 'true' : 'false');
  }

  _syncClearButton() {
    const btn = this.shadowRoot.getElementById('clear-btn');
    const input = this._getInput();
    if (!btn || !input) return;
    if (String(input.value || '').trim()) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
  }

  _clear() {
    const input = this._getInput();
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.dispatchEvent(new CustomEvent('ui-combobox-change', { bubbles: true, composed: true, detail: { value: '' } }));
    this._syncClearButton();
    this.close();
    input.focus();
  }

  _onKeyDown(e) {
    const input = this._getInput();
    if (!input) return;

    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.open();
      this._moveActive(1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.open();
      this._moveActive(-1);
      return;
    }

    if (e.key === 'Enter') {
      if (!this._open) return;
      e.preventDefault();
      if (this._activeIndex >= 0) {
        this._selectByIndex(this._activeIndex);
      } else {
        // If no active option, treat as "create/select current"
        this._selectByIndex(0);
      }
      return;
    }

    if (e.key === 'Tab') {
      this.close();
    }
  }

  _moveActive(delta) {
    const options = this.shadowRoot.querySelectorAll('.combobox-option');
    const count = options.length;
    if (count === 0) return;
    let next = this._activeIndex + delta;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;
    this._activeIndex = next;
    this._renderList();
    const active = this.shadowRoot.querySelector(`.combobox-option[data-idx="${next}"]`);
    active?.scrollIntoView?.({ block: 'nearest' });
  }

  _selectByIndex(idx) {
    const input = this._getInput();
    if (!input) return;

    const list = this._buildOptions();
    const opt = list[idx];
    if (!opt) return;

    if (opt.kind === 'create') {
      const value = normalizeDisplay(opt.value);
      const normalized = normalizeKey(value);
      const existing = this._items.find((it) => normalizeKey(it.normalizedName || it.name) === normalized);
      const finalValue = existing ? normalizeDisplay(existing.name) : value;

      input.value = finalValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      if (!existing) {
        this.dispatchEvent(new CustomEvent('ui-combobox-create', { bubbles: true, composed: true, detail: { value } }));
      }
      this.dispatchEvent(new CustomEvent('ui-combobox-change', { bubbles: true, composed: true, detail: { value: finalValue } }));
      this.close();
      return;
    }

    input.value = normalizeDisplay(opt.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.dispatchEvent(new CustomEvent('ui-combobox-change', { bubbles: true, composed: true, detail: { value: input.value } }));
    this.close();
  }

  _buildOptions() {
    const input = this._getInput();
    const q = normalizeDisplay(input?.value);
    const qKey = normalizeKey(q);

    const items = (this._items || [])
      .map((it) => ({
        id: it?.id,
        name: normalizeDisplay(it?.name ?? it),
        normalizedName: it?.normalizedName ? String(it.normalizedName) : normalizeKey(it?.name ?? it),
      }))
      .filter((it) => it.name);

    const matches = q
      ? items.filter((it) => it.name.toLowerCase().includes(q.toLowerCase()))
      : items;

    const sorted = matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const out = [];

    if (q) {
      const exact = items.some((it) => normalizeKey(it.normalizedName || it.name) === qKey);
      if (!exact) {
        out.push({ kind: 'create', value: q });
      }
    }

    for (const it of sorted) out.push({ kind: 'item', value: it.name });
    return out;
  }

  _renderList() {
    const popover = this.shadowRoot.getElementById('popover');
    if (!popover) return;
    if (!this._open) {
      popover.hidden = true;
      return;
    }

    const input = this._getInput();
    const q = normalizeDisplay(input?.value);
    const selectedKey = normalizeKey(q);
    const options = this._buildOptions();
    popover.replaceChildren();

    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'combobox-empty';
      empty.textContent = t('combobox.no_matches');
      popover.appendChild(empty);
      return;
    }

    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `combobox-option${idx === this._activeIndex ? ' is-active' : ''}${opt.kind === 'create' ? ' is-create' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('data-idx', String(idx));

      const left = document.createElement('span');
      left.className = 'combobox-option__label';
      if (opt.kind === 'create') {
        const icon = document.createElement('span');
        icon.className = 'combobox-option__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '+';
        left.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'combobox-option__text';
        label.textContent = t('create.item', { value: opt.value });
        left.appendChild(label);
      } else {
        const label = document.createElement('span');
        label.className = 'combobox-option__text';
        label.appendChild(renderHighlightedText(opt.value, q));
        left.appendChild(label);
      }

      btn.appendChild(left);

      if (opt.kind === 'item') {
        const optKey = normalizeKey(opt.value);
        const isSelected = selectedKey && optKey === selectedKey;
        if (isSelected) {
          const mark = document.createElement('span');
          mark.className = 'combobox-option__mark';
          mark.setAttribute('aria-hidden', 'true');
          mark.textContent = '✓';
          btn.appendChild(mark);
        }
      }
      popover.appendChild(btn);
    });
  }
}

customElements.define('ui-combobox', UiCombobox);
