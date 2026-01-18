import { sharedStylesTag } from './shared-styles.js';

class UiEmptyState extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      ${sharedStylesTag()}
      <div class="empty-state">
        <div class="empty-state__icon">
          <slot name="icon"></slot>
        </div>
        <h3 class="empty-state__title"><slot name="heading"></slot></h3>
        <p class="empty-state__message"><slot name="message"></slot></p>
        <div class="empty-state__action"><slot name="action"></slot></div>
      </div>
    `;
  }
}

customElements.define('ui-empty-state', UiEmptyState);
