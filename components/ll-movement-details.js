import { db } from '../db/indexeddb.js';
import { t } from '../i18n/loader.js';
import { sharedStylesTag } from './shared-styles.js';
import { lockBodyScroll, unlockBodyScroll } from './ui-scroll-lock.js';
import { registerModal, unregisterModal } from './ui-dialog.js';

class LlMovementDetails extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._movementId = null;
    this._movement = null;
    this._map = null;
    this._attempts = [];
    this._changes = [];
    this._modalToken = null;
    this._restoreFocusEl = null;
  }

  connectedCallback() {
    this.render();
    if (!this.style.display) this.style.display = 'none';
  }

  async show({ movementId } = {}) {
    this._movementId = movementId ? String(movementId) : null;
    await this.refresh();
    this._restoreFocusEl = document.activeElement;
    this.style.display = 'flex';
    lockBodyScroll();
    this._modalToken = registerModal({ close: () => this.hide(), restoreFocusEl: this._restoreFocusEl });

    const close = this.shadowRoot.getElementById('close-btn');
    close?.focus?.();
  }

  hide() {
    this.style.display = 'none';
    unlockBodyScroll();
    if (this._modalToken) {
      const token = this._modalToken;
      this._modalToken = null;
      unregisterModal(token);
    }
    this._movementId = null;
    this._movement = null;
    this._map = null;
    this._attempts = [];
    this._changes = [];
    this.render();
    this.dispatchEvent(new CustomEvent('ll-movement-details-close', { bubbles: true, composed: true }));
  }

  async refresh() {
    if (!this._movementId) {
      this.render();
      return;
    }
    await db.open();
    const movementId = this._movementId;
    const [movement, map, attempts, changes] = await Promise.all([
      db.get('movements', movementId),
      db.get('movement_remote_map', movementId),
      db.getAllByIndex('movement_send_attempts', 'movementId', movementId),
      db.getAllByIndex('movement_change_log', 'movementId', movementId),
    ]);
    this._movement = movement || null;
    this._map = map || null;
    this._attempts = Array.isArray(attempts) ? attempts.slice().sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0)) : [];
    this._changes = Array.isArray(changes) ? changes.slice().sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0)) : [];
    this.render();
  }

  _formatTs(ts) {
    try {
      if (!ts) return '';
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts || '');
    }
  }

  _renderJson(value) {
    const pre = document.createElement('pre');
    pre.className = 'details-pre';
    try {
      pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      pre.textContent = String(value);
    }
    return pre;
  }

  _lastAttemptFailed() {
    const last = this._attempts?.[0];
    return last?.status === 'failed';
  }

  render() {
    const movementId = this._movementId;
    const remote = this._map?.remoteTxnId ? String(this._map.remoteTxnId) : '';
    const canRetry = Boolean(movementId) && this._lastAttemptFailed() && !remote;

    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="overlay" role="presentation">
        <div class="modal modal--details" role="dialog" aria-modal="true" aria-labelledby="title">
          <div class="modal-header">
            <h2 class="modal-title" id="title">${t('movement.details.title')}</h2>
            <button class="icon-btn" id="close-btn" type="button" aria-label="${t('close')}" title="${t('close')}">✕</button>
          </div>
          <div class="modal-body">
            <div class="details-summary">
              <div><strong>${t('date')}:</strong> <span id="sum-date"></span></div>
              <div><strong>${t('paid.value')}:</strong> <span id="sum-amount"></span></div>
              <div><strong>${t('send.remote_id')}:</strong> <span id="sum-remote"></span></div>
            </div>

            <div class="details-section">
              <h3 class="details-h">${t('send.history')}</h3>
              <div id="send-history"></div>
            </div>

            <div class="details-section">
              <h3 class="details-h">${t('change.history')}</h3>
              <div id="change-history"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" id="retry-btn" type="button" ${canRetry ? '' : 'hidden'}>${t('send.retry')}</button>
            <button class="btn primary" id="done-btn" type="button">${t('close')}</button>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelector('.overlay')?.addEventListener('click', (e) => {
      if (e.target?.classList?.contains('overlay')) this.hide();
    });

    this.shadowRoot.getElementById('close-btn')?.addEventListener('click', () => this.hide());
    this.shadowRoot.getElementById('done-btn')?.addEventListener('click', () => this.hide());
    this.shadowRoot.getElementById('retry-btn')?.addEventListener('click', () => {
      if (!this._movementId) return;
      this.dispatchEvent(
        new CustomEvent('ll-movement-details-retry', {
          bubbles: true,
          composed: true,
          detail: { movementId: this._movementId },
        }),
      );
    });

    const dateEl = this.shadowRoot.getElementById('sum-date');
    const amtEl = this.shadowRoot.getElementById('sum-amount');
    const remoteEl = this.shadowRoot.getElementById('sum-remote');

    if (dateEl) dateEl.textContent = String(this._movement?.date || '');
    if (amtEl) amtEl.textContent = String(this._movement?.paidValue ?? '');
    if (remoteEl) remoteEl.textContent = remote || t('send.not_sent');

    this._renderSendHistory();
    this._renderChangeHistory();
  }

  _renderSendHistory() {
    const wrap = this.shadowRoot.getElementById('send-history');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!this._movementId) return;

    if (!this._attempts.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('send.history.empty');
      wrap.appendChild(p);
      return;
    }

    const list = document.createElement('div');
    list.className = 'history-list';
    for (const a of this._attempts) {
      const row = document.createElement('details');
      row.className = `history-item history-item--${String(a?.status || 'pending')}`;
      const sum = document.createElement('summary');
      sum.className = 'history-summary';
      const left = document.createElement('span');
      left.textContent = `${this._formatTs(a?.createdAt)} · ${String(a?.status || '')}`;
      const right = document.createElement('span');
      right.className = 'muted';
      right.textContent = a?.durationMs != null ? `${Math.round(Number(a.durationMs))}ms` : '';
      sum.appendChild(left);
      sum.appendChild(right);
      row.appendChild(sum);

      const body = document.createElement('div');
      body.className = 'history-body';

      if (a?.remoteTxnId) {
        const p = document.createElement('p');
        p.textContent = `${t('send.remote_id')}: ${String(a.remoteTxnId)}`;
        body.appendChild(p);
      }
      if (a?.errorMessage) {
        const p = document.createElement('p');
        p.textContent = `${t('error')}: ${String(a.errorMessage)}`;
        body.appendChild(p);
      }

      body.appendChild(this._renderJson({ request: a?.requestPayload, response: a?.responsePayload }));
      row.appendChild(body);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  _renderChangeHistory() {
    const wrap = this.shadowRoot.getElementById('change-history');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!this._movementId) return;

    if (!this._changes.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('change.history.empty');
      wrap.appendChild(p);
      return;
    }

    const list = document.createElement('div');
    list.className = 'history-list';
    for (const c of this._changes) {
      const row = document.createElement('details');
      row.className = 'history-item';
      const sum = document.createElement('summary');
      sum.className = 'history-summary';
      const action = String(c?.action || '');
      const src = c?.source ? ` · ${String(c.source)}` : '';
      sum.textContent = `${this._formatTs(c?.createdAt)} · ${action}${src}`;
      row.appendChild(sum);

      const body = document.createElement('div');
      body.className = 'history-body';
      if (Array.isArray(c?.diff) && c.diff.length) {
        const ul = document.createElement('ul');
        ul.className = 'diff-list';
        for (const d of c.diff) {
          const li = document.createElement('li');
          li.textContent = `${String(d.field)}: ${String(d.from)} → ${String(d.to)}`;
          ul.appendChild(li);
        }
        body.appendChild(ul);
      }
      body.appendChild(this._renderJson({ before: c?.before, after: c?.after }));
      row.appendChild(body);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }
}

customElements.define('ll-movement-details', LlMovementDetails);
