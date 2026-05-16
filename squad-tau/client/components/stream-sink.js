/**
 * <stream-sink> — native Web Component, zero React coupling.
 *
 * Lifecycle:
 *   connectedCallback    → registers its TextNode with StreamRouter
 *   disconnectedCallback → unregisters from StreamRouter
 *   attributeChangedCallback(urn)  → re-registers on URN change
 *
 * React renders this as a placeholder shell. The StreamRouter
 * writes directly into the shadow DOM TextNode, bypassing React entirely.
 */
import { streamRouter } from '../stream-router.js';

const STYLE = `
  :host { display: inline; white-space: pre-wrap; overflow-wrap: break-word; }
  ::slotted(*) { display: inline; }
`;

class StreamSink extends HTMLElement {
    static observedAttributes = ['urn'];

    constructor() {
        super();
        this._textNode = null;
    }

    connectedCallback() {
        this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLE;
        this.shadowRoot.appendChild(style);
        this._textNode = document.createTextNode('');
        this.shadowRoot.appendChild(this._textNode);

        const urn = this.getAttribute('urn');
        if (urn) streamRouter.register(urn, this._textNode);
    }

    disconnectedCallback() {
        const urn = this.getAttribute('urn');
        if (urn) streamRouter.unregister(urn);
        this._textNode = null;
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'urn' && oldVal !== newVal) {
            if (oldVal) streamRouter.unregister(oldVal);
            if (newVal && this._textNode) streamRouter.register(newVal, this._textNode);
        }
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('stream-sink')) {
    customElements.define('stream-sink', StreamSink);
}

export { StreamSink };
