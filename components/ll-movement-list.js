import { getActiveLang, t } from '../i18n/loader.js';
import { showToast } from './ui-toast.js';
import { sharedStylesTag } from './shared-styles.js';

class LlMovementList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.movements = [];
    this._currencyCode = 'EUR';
    this._query = '';
    this._filterTimer = null;
    this._sendingIds = new Set();
    this._onI18nUpdated = () => this.render();
  }

  connectedCallback() {
    window.addEventListener('i18n:updated', this._onI18nUpdated);
    this.shadowRoot.addEventListener('click', (e) => {
      const soon = e.target.closest('[data-soon]');
      if (soon) {
        showToast(t('not_implemented'), { variant: 'warning' });
      }
    });
    this.shadowRoot.addEventListener('input', (e) => {
      if (e.target?.id !== 'search-filter') return;
      this._setQuery(String(e.target.value || ''));
    });
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('i18n:updated', this._onI18nUpdated);
  }

  setMovements(movements) {
    this.movements = movements;
    this.render();
  }

  setCurrency({ code } = {}) {
    const next = String(code || '').toUpperCase();
    if (!next) return;
    if (next === this._currencyCode) return;
    this._currencyCode = next;
    this.render();
  }

  setSendingMovementIds(ids) {
    const next = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)));
    this._sendingIds = next;
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <section aria-label="${t('movements')}">
        <div class="list-toolbar">
          <label class="visually-hidden" for="search-filter">${t('filter')}</label>
          <div class="search-field">
            <input type="search" id="search-filter" placeholder="${t('filter')}" inputmode="search" autocomplete="off" value="${this._escapeAttr(this._query)}">
          </div>
        </div>
        <div id="list-container">
        </div>
      </section>
    `;

    const input = this.shadowRoot.getElementById('search-filter');
    if (input && input.value !== this._query) input.value = this._query;

    this._renderMovements();
  }

  _escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _setQuery(next) {
    const q = String(next ?? '');
    this._query = q;

    if (this._filterTimer) window.clearTimeout(this._filterTimer);
    this._filterTimer = window.setTimeout(() => {
      this._filterTimer = null;
      this._renderMovements();
    }, q.trim() ? 120 : 0);
  }

  _renderMovements() {
    const container = this.shadowRoot.getElementById('list-container');
    if (!container) return;
    container.innerHTML = '';

    const all = Array.isArray(this.movements) ? this.movements : [];
    if (all.length === 0) {
      container.appendChild(this._buildEmptyState({ icon: '📝', title: t('no.movements.title'), message: t('no.movements.message'), actionId: 'add-first-movement-btn', actionLabel: t('add.movement') }));
      return;
    }

    const q = this._query.trim();
    const filtered = q ? all.filter((m) => this._movementMatches(m, q)) : all;

    if (q && filtered.length === 0) {
      container.appendChild(this._buildEmptyState({ icon: '🔎', title: t('no.matches.title'), message: t('no.matches.message') }));
      return;
    }

    const cards = document.createElement('div');
    cards.className = 'movement-cards';
    for (const m of filtered) cards.appendChild(this._buildMovementCard(m, q));

    const tableWrap = document.createElement('div');
    tableWrap.className = 'movement-table-wrap card';
    tableWrap.appendChild(this._buildMovementTable(filtered, q));

    container.appendChild(cards);
    container.appendChild(tableWrap);
  }

  _movementMatches(m, query) {
    const q = String(query).toLowerCase();
    const dateStr = this._formatDate(m?.date);
    const vendor = String(m?.vendor ?? '');
    const expenseType = String(m?.expenseType ?? '');
    const notes = String(m?.notes ?? '');
    const txnType = m?.txnType === 'income' ? 'income' : 'expense';
    const txnLabel = txnType === 'income' ? t('income') : t('expense');

    const paidCurrency = this._formatCurrency(m?.paidValue);
    const docValue = this._formatCurrency(m?.docValue);
    const paidValue = this._formatCurrency(m?.paidValue);
    const interest = this._formatCurrency(m?.interest);
    const discount = this._formatCurrency(m?.discount);

    const hay = [
      dateStr,
      vendor,
      expenseType,
      notes,
      txnType,
      txnLabel,
      paidCurrency,
      docValue,
      paidValue,
      interest,
      discount,
    ]
      .join(' ')
      .toLowerCase();

    return hay.includes(q);
  }

  _formatSignedCurrency(value, txnType) {
    const base = this._formatCurrency(value);
    if (!base) return '';
    if (txnType === 'income') return `+${base}`;
    return `−${base}`;
  }

  _txnTypeFor(m) {
    return m?.txnType === 'income' ? 'income' : 'expense';
  }

  _txnSignFor(txnType) {
    return txnType === 'income' ? '+' : '−';
  }

  _buildTxnValueNode({ txnType, amountText, query }) {
    const wrap = document.createElement('span');
    wrap.className = 'txn-value';

    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = txnType === 'income' ? t('income') : t('expense');
    wrap.appendChild(sr);

    const sign = document.createElement('span');
    sign.className = `txn-sign txn-sign--${txnType}`;
    sign.setAttribute('aria-hidden', 'true');
    sign.textContent = this._txnSignFor(txnType);
    wrap.appendChild(sign);

    const amount = document.createElement('span');
    amount.className = 'txn-amount';
    this._appendHighlighted(amount, amountText, query);
    wrap.appendChild(amount);

    return wrap;
  }

  _formatDate(date) {
    try {
      if (!date) return '';
      return new Date(date).toLocaleDateString();
    } catch {
      return '';
    }
  }

  _formatCurrency(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    try {
      const lang = typeof getActiveLang === 'function' ? getActiveLang() : navigator.language;
      return new Intl.NumberFormat(lang, { style: 'currency', currency: this._currencyCode }).format(n);
    } catch {
      return n.toFixed(2);
    }
  }

  _formatNumberish(value) {
    if (value == null) return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toFixed(2);
  }

  _buildEmptyState({ icon, title, message, actionId, actionLabel }) {
    const el = document.createElement('ui-empty-state');

    const iconNode = document.createElement('span');
    iconNode.setAttribute('slot', 'icon');
    iconNode.textContent = icon || '';
    el.appendChild(iconNode);

    const headingNode = document.createElement('span');
    headingNode.setAttribute('slot', 'heading');
    headingNode.textContent = title || '';
    el.appendChild(headingNode);

    const messageNode = document.createElement('span');
    messageNode.setAttribute('slot', 'message');
    messageNode.textContent = message || '';
    el.appendChild(messageNode);

    if (actionId && actionLabel) {
      const actionBtn = document.createElement('button');
      actionBtn.setAttribute('slot', 'action');
      actionBtn.className = 'btn primary';
      actionBtn.id = actionId;
      actionBtn.type = 'button';
      actionBtn.textContent = actionLabel;
      el.appendChild(actionBtn);
    }

    return el;
  }

  _appendHighlighted(parent, text, query) {
    const q = String(query || '').trim();
    const full = String(text ?? '');
    if (!q) {
      parent.textContent = full;
      return;
    }

    const lowerText = full.toLowerCase();
    const lowerQuery = q.toLowerCase();
    let idx = 0;
    while (idx < full.length) {
      const hit = lowerText.indexOf(lowerQuery, idx);
      if (hit === -1) {
        parent.appendChild(document.createTextNode(full.slice(idx)));
        break;
      }
      if (hit > idx) parent.appendChild(document.createTextNode(full.slice(idx, hit)));
      const mark = document.createElement('mark');
      mark.className = 'match';
      mark.textContent = full.slice(hit, hit + lowerQuery.length);
      parent.appendChild(mark);
      idx = hit + lowerQuery.length;
    }
  }

  _buildMovementCard(movement, query) {
    const article = document.createElement('article');
    article.className = 'movement-card card';
    article.dataset.id = String(movement?.id ?? '');
    const isSending = this._sendingIds.has(String(movement?.id ?? ''));

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'movement-summary';

    const left = document.createElement('div');
    const vendor = document.createElement('div');
    vendor.className = 'movement-vendor';
    this._appendHighlighted(vendor, movement?.vendor ?? '', query);
    const date = document.createElement('div');
    date.className = 'movement-date';
    this._appendHighlighted(date, this._formatDate(movement?.date), query);
    left.appendChild(vendor);
    left.appendChild(date);

    const value = document.createElement('div');
    value.className = 'movement-value';
    const txnType = this._txnTypeFor(movement);
    value.appendChild(this._buildTxnValueNode({ txnType, amountText: this._formatCurrency(movement?.paidValue), query }));

    summary.appendChild(left);
    summary.appendChild(value);
    details.appendChild(summary);

    const meta = document.createElement('div');
    meta.className = 'movement-meta';
    const chip = document.createElement('span');
    chip.className = 'chip';
    this._appendHighlighted(chip, movement?.expenseType ?? '', query);
    meta.appendChild(chip);
    details.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'movement-details-body';
    body.appendChild(this._buildKvRow(t('doc.value'), this._formatCurrency(movement?.docValue), query));
    body.appendChild(this._buildKvRow(t('interest'), this._formatCurrency(movement?.interest), query));
    body.appendChild(this._buildKvRow(t('discount'), this._formatCurrency(movement?.discount), query));
    body.appendChild(this._buildKvRow(t('paid.value'), this._formatCurrency(movement?.paidValue), query));
    if (movement?.notes) body.appendChild(this._buildKvRow(t('notes'), String(movement.notes), query));
    details.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'movement-actions';
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn secondary send-btn';
    sendBtn.type = 'button';
    if (isSending) {
      sendBtn.disabled = true;
      sendBtn.setAttribute('aria-label', t('send.sending'));
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      sendBtn.appendChild(spinner);
      sendBtn.appendChild(document.createTextNode(t('send.sending')));
    } else {
      sendBtn.textContent = t('send');
    }
    const editBtn = document.createElement('button');
    editBtn.className = 'btn secondary edit-btn';
    editBtn.type = 'button';
    editBtn.textContent = t('edit');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn secondary delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.textContent = t('delete');
    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'btn secondary details-btn';
    detailsBtn.type = 'button';
    detailsBtn.textContent = t('details');

    if (isSending) {
      editBtn.disabled = true;
      deleteBtn.disabled = true;
      detailsBtn.disabled = true;
    }

    actions.appendChild(sendBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(detailsBtn);
    details.appendChild(actions);

    article.appendChild(details);
    return article;
  }

  _buildKvRow(label, value, query) {
    const row = document.createElement('div');
    row.className = 'kv';
    const k = document.createElement('span');
    k.textContent = String(label ?? '');
    const v = document.createElement('strong');
    this._appendHighlighted(v, String(value ?? ''), query);
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }

  _buildMovementTable(movements, query) {
    const table = document.createElement('table');
    table.className = 'data-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');

    const thSelect = document.createElement('th');
    thSelect.className = 'checkbox-col';
    const selectLabel = document.createElement('label');
    selectLabel.className = 'ui-checkbox';
    const selectInput = document.createElement('input');
    selectInput.type = 'checkbox';
    selectInput.id = 'select-all-checkbox';
    selectInput.setAttribute('aria-label', t('select.all'));
    const selectBox = document.createElement('span');
    selectBox.className = 'ui-checkbox__box';
    selectBox.setAttribute('aria-hidden', 'true');
    selectLabel.appendChild(selectInput);
    selectLabel.appendChild(selectBox);
    thSelect.appendChild(selectLabel);
    trHead.appendChild(thSelect);

    const headCells = [
      { key: 'date', alignRight: false },
      { key: 'vendor', alignRight: false },
      { key: 'expense.type', alignRight: false },
      { key: 'paid.value', alignRight: true },
      { key: 'actions', alignRight: false },
    ];
    for (const hc of headCells) {
      const th = document.createElement('th');
      if (hc.alignRight) th.setAttribute('align', 'right');
      th.textContent = t(hc.key);
      trHead.appendChild(th);
    }

    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const m of movements) {
      const tr = document.createElement('tr');
      tr.dataset.id = String(m?.id ?? '');
      const isSending = this._sendingIds.has(String(m?.id ?? ''));

      const tdSelect = document.createElement('td');
      tdSelect.className = 'checkbox-col';
      const rowLabel = document.createElement('label');
      rowLabel.className = 'ui-checkbox';
      const rowInput = document.createElement('input');
      rowInput.type = 'checkbox';
      rowInput.className = 'row-checkbox';
      rowInput.setAttribute('aria-label', t('select.row'));
      const rowBox = document.createElement('span');
      rowBox.className = 'ui-checkbox__box';
      rowBox.setAttribute('aria-hidden', 'true');
      rowLabel.appendChild(rowInput);
      rowLabel.appendChild(rowBox);
      tdSelect.appendChild(rowLabel);
      tr.appendChild(tdSelect);

      const tdDate = document.createElement('td');
      this._appendHighlighted(tdDate, this._formatDate(m?.date), query);
      tr.appendChild(tdDate);

      const tdVendor = document.createElement('td');
      this._appendHighlighted(tdVendor, m?.vendor ?? '', query);
      tr.appendChild(tdVendor);

      const tdExpense = document.createElement('td');
      this._appendHighlighted(tdExpense, m?.expenseType ?? '', query);
      tr.appendChild(tdExpense);

      const tdPaid = document.createElement('td');
      tdPaid.setAttribute('align', 'right');
      const txnType = this._txnTypeFor(m);
      tdPaid.appendChild(this._buildTxnValueNode({ txnType, amountText: this._formatCurrency(m?.paidValue), query }));
      tr.appendChild(tdPaid);

      const tdActions = document.createElement('td');
      const rowActions = document.createElement('span');
      rowActions.className = 'row-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn edit-btn';
      editBtn.type = 'button';
      editBtn.setAttribute('title', t('edit'));
      editBtn.setAttribute('aria-label', t('edit'));
      editBtn.textContent = '✏️';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn delete-btn';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('title', t('delete'));
      deleteBtn.setAttribute('aria-label', t('delete'));
      deleteBtn.textContent = '🗑️';
      const sendBtn = document.createElement('button');
      sendBtn.className = 'icon-btn send-btn';
      sendBtn.type = 'button';
      if (isSending) {
        sendBtn.disabled = true;
        sendBtn.setAttribute('title', t('send.sending'));
        sendBtn.setAttribute('aria-label', t('send.sending'));
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        spinner.setAttribute('aria-hidden', 'true');
        sendBtn.appendChild(spinner);
      } else {
        sendBtn.setAttribute('title', t('send'));
        sendBtn.setAttribute('aria-label', t('send'));
        sendBtn.textContent = '📤';
      }
      const detailsBtn = document.createElement('button');
      detailsBtn.className = 'icon-btn details-btn';
      detailsBtn.type = 'button';
      detailsBtn.setAttribute('title', t('details'));
      detailsBtn.setAttribute('aria-label', t('details'));
      detailsBtn.textContent = 'ℹ️';

      if (isSending) {
        editBtn.disabled = true;
        deleteBtn.disabled = true;
        detailsBtn.disabled = true;
      }

      rowActions.appendChild(sendBtn);
      rowActions.appendChild(editBtn);
      rowActions.appendChild(deleteBtn);
      rowActions.appendChild(detailsBtn);
      tdActions.appendChild(rowActions);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
}

customElements.define('ll-movement-list', LlMovementList);
