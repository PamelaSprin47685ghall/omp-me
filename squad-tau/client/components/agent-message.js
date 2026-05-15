/**
 * <agent-message> — Zero-coupling streaming message Custom Element.
 *
 * Exposes two public methods:
 *   appendChunk(text, type) — append streaming delta
 *   finalize(text?)         — end streaming, render markdown
 *
 * No document.addEventListener. No global event awareness.
 * Pure DOM component with style-isolated shadow DOM.
 */

import { marked } from 'marked';

const STYLE = `
  :host {
    display: block;
  }
  .thinking-section {
    font-size: 0.875rem;
  }
  .thinking-summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem;
    border-radius: 0.25rem;
  }
  .thinking-summary:hover {
    background: var(--chakra-colors-bg-muted, #f0f0f0);
  }
  .thinking-summary svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
  .thinking-badge {
    background: var(--chakra-colors-blue-solid, #3182ce);
    color: white;
    font-size: 0.75rem;
    padding: 0 0.5rem;
    border-radius: 0.25rem;
    line-height: 1.25rem;
  }
  .thinking-badge.live {
    display: inline;
  }
  .thinking-badge.final {
    display: none;
  }
  .thinking-pre {
    margin: 0;
    padding: 0.75rem;
    background: var(--chakra-colors-bg-muted, #f7f7f7);
    border-radius: 0.25rem;
    overflow-x: auto;
    font-size: 0.875rem;
    white-space: pre-wrap;
    font-family: monospace;
  }
  .text-box {
    display: flex;
    align-items: flex-start;
    white-space: pre-wrap;
  }
  .text-box.finalized {
    white-space: normal;
  }
  .markdown-body {
    padding: 0.25rem 0;
    line-height: 1.6;
    overflow-wrap: break-word;
    width: 100%;
  }
  .markdown-body p { margin: 0.5em 0; }
  .markdown-body p:first-child { margin-top: 0; }
  .markdown-body code {
    background: var(--chakra-colors-bg-muted, #f0f0f0);
    padding: 0.125rem 0.25rem;
    border-radius: 0.125rem;
    font-size: 0.875em;
  }
  .markdown-body pre {
    background: var(--chakra-colors-bg-muted, #f0f0f0);
    padding: 0.75rem;
    border-radius: 0.25rem;
    overflow-x: auto;
  }
  .markdown-body pre code {
    background: none;
    padding: 0;
  }
`;

class AgentMessage extends HTMLElement {
    static observedAttributes = ['message-id', 'role'];

    constructor() {
        super();
        this._text = '';
        this._thinking = '';
        this._finalized = false;
        this._textNode = null;
        this._thinkingNode = null;
        this._badgeEl = null;
        this._detailsEl = null;
        this._textBox = null;
    }

    connectedCallback() {
        const messageId = this.getAttribute('message-id');
        if (!messageId) return;

        if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
          <style>${STYLE}</style>
          <div class="thinking-section" style="display:none">
            <details open>
              <summary class="thinking-summary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
                <span>Thinking</span>
                <span class="thinking-badge live">live</span>
              </summary>
              <pre class="thinking-pre"><slot name="thinking-text"></slot></pre>
            </details>
          </div>
          <div class="text-box">
            <slot name="message-text"></slot>
          </div>
        `;

        this._detailsEl = this.shadowRoot.querySelector('.thinking-section');
        this._badgeEl = this.shadowRoot.querySelector('.thinking-badge');
        this._textBox = this.shadowRoot.querySelector('.text-box');

        const thinkingSpan = document.createElement('span');
        thinkingSpan.slot = 'thinking-text';
        this._thinkingNode = document.createTextNode('');
        thinkingSpan.appendChild(this._thinkingNode);

        const textSpan = document.createElement('span');
        textSpan.slot = 'message-text';
        this._textNode = document.createTextNode('');
        textSpan.appendChild(this._textNode);

        this.appendChild(thinkingSpan);
        this.appendChild(textSpan);

        // Drain any early tokens that arrived before this element was mounted
        const early = readStreamBuffer(messageId);
        if (early) {
            if (early.thinking) {
                if (this._detailsEl) this._detailsEl.style.display = '';
                this._thinking = early.thinking;
                this._thinkingNode.appendData(early.thinking);
            }
            if (early.text) {
                this._text = early.text;
                this._textNode.appendData(early.text);
            }
        }

        if (this._finalized) this._setFinalizedUI();
    }

    disconnectedCallback() {}

    appendChunk(text, type = 'text') {
        if (this._finalized || !text) return;
        // Buffer if not yet connected (Shadow DOM not ready)
        if (!this._textNode) {
            pushEarlyBuffer(this.getAttribute('message-id'), text, type);
            return;
        }
        if (type === 'thinking') {
            if (this._detailsEl) this._detailsEl.style.display = '';
            this._thinking += text;
            this._thinkingNode?.appendData(text);
        } else {
            this._text += text;
            this._textNode?.appendData(text);
        }
    }

    finalize(text) {
        if (this._finalized) return;
        this._finalized = true;
        if (text && this._text === '') {
            this._text = text;
            if (this._textNode) this._textNode.data = text;
        }
        this._setFinalizedUI();
        this._renderMarkdown();
    }

    _setFinalizedUI() {
        if (this._badgeEl) {
            this._badgeEl.classList.remove('live');
            this._badgeEl.classList.add('final');
            this._badgeEl.textContent = 'done';
        }
        if (this._textBox) this._textBox.classList.add('finalized');
    }

    _renderMarkdown() {
        if (!this._text) return;
        const html = marked.parse(this._text, { breaks: true, gfm: true });
        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-body';
        wrapper.innerHTML = html;

        const textSlot = this.shadowRoot.querySelector('slot[name="message-text"]');
        const oldSpan = textSlot ? textSlot.parentNode : null;
        if (oldSpan) {
            oldSpan.innerHTML = '';
            oldSpan.appendChild(wrapper);
        }
    }
}

// ── Early-token buffer ──
// StreamRouter may deliver deltas before <agent-message> is mounted in DOM.
const _earlyBuffer = new Map();

export function readStreamBuffer(messageId) {
    const buf = _earlyBuffer.get(messageId);
    if (!buf) return null;
    return { text: buf.text, thinking: buf.thinking };
}

export function deleteStreamBuffer(messageId) {
    _earlyBuffer.delete(messageId);
}

export function pushEarlyBuffer(messageId, text, type) {
    let buf = _earlyBuffer.get(messageId);
    if (!buf) {
        buf = { text: '', thinking: '' };
        _earlyBuffer.set(messageId, buf);
    }
    if (type === 'thinking') buf.thinking += text;
    else buf.text += text;
}

if (typeof window !== 'undefined') {
    window.__earlyBuffer = { push: pushEarlyBuffer, read: readStreamBuffer, delete: deleteStreamBuffer };
}

customElements.define('agent-message', AgentMessage);

export { AgentMessage };
