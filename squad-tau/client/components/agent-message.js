/**
 * <agent-message> — Immortal Custom Element for streaming message display.
 *
 * Takes over the entire lifecycle of an assistant message:
 * - Streaming phase: receives delta CustomEvents, appends via appendData
 * - Finalization phase: receives stream:end, runs marked.js for markdown render
 *
 * React renders this element once and never touches it again.
 * No handoff, no content in state tree, no React re-renders during streaming.
 *
 * Attributes:
 *   message-id  — URN identifying this message
 *   role        — 'assistant' | 'user' (user messages use staticContent instead)
 */

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
        this._streaming = true;
        this._finalized = false;
        this._messageId = '';
        this._textNode = null;
        this._thinkingNode = null;
        this._badgeEl = null;
        this._detailsEl = null;
        this._textBox = null;
        this._deltaHandler = null;
        this._endHandler = null;
        this._markedPromise = null;
    }

    connectedCallback() {
        const messageId = this.getAttribute('message-id');
        const role = this.getAttribute('role');
        if (!messageId) return;

        this._messageId = messageId;

        // Attach shadow DOM for style isolation
        if (!this.shadowRoot) {
            this.attachShadow({ mode: 'open' });
        }

        // Build skeleton
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

        // Create text nodes in slots
        const thinkingSlot = this.shadowRoot.querySelector('slot[name="thinking-text"]');
        const textSlot = this.shadowRoot.querySelector('slot[name="message-text"]');

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

        // Set up event listeners
        this._deltaHandler = (e) => {
            if (e.detail.messageId !== this._messageId) return;
            if (this._finalized) return;

            if (e.detail.type === 'thinking' || e.detail.type === 'thinking_delta') {
                if (this._detailsEl) this._detailsEl.style.display = '';
                this._thinking += e.detail.text;
                if (this._thinkingNode) this._thinkingNode.appendData(e.detail.text);
            } else {
                this._text += e.detail.text;
                if (this._textNode) this._textNode.appendData(e.detail.text);
            }
        };

        this._endHandler = (e) => {
            if (e.detail.messageId !== this._messageId) return;
            if (this._finalized) return;
            this._streaming = false;
            this._finalized = true;

            // If text was provided directly (non-streamed message), set it
            if (e.detail.text && this._text === '' && this._thinking === '') {
                if (e.detail.type === 'thinking') {
                    this._thinking = e.detail.text;
                    if (this._thinkingNode) this._thinkingNode.appendData(e.detail.text);
                } else {
                    this._text = e.detail.text;
                    if (this._textNode) this._textNode.appendData(e.detail.text);
                }
            }

            // Finalize UI
            if (this._badgeEl) {
                this._badgeEl.classList.remove('live');
                this._badgeEl.classList.add('final');
                this._badgeEl.textContent = 'done';
            }
            if (this._textBox) {
                this._textBox.classList.add('finalized');
            }

            // Run markdown rendering on accumulated text
            this._renderMarkdown();
        };

        document.addEventListener('delta', this._deltaHandler);
        document.addEventListener('stream:end', this._endHandler);
    }

    disconnectedCallback() {
        if (this._deltaHandler) document.removeEventListener('delta', this._deltaHandler);
        if (this._endHandler) document.removeEventListener('stream:end', this._endHandler);
    }

    async _renderMarkdown() {
        if (!this._text) return;
        const marked = await loadMarked();
        if (!marked) return;

        const html = marked.parse(this._text, { breaks: true, gfm: true });
        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-body';
        wrapper.innerHTML = html;

        // Replace the text node in the slot
        const textSlot = this.shadowRoot.querySelector('slot[name="message-text"]');
        const oldSpan = textSlot ? textSlot.parentNode : null;
        if (oldSpan) {
            oldSpan.innerHTML = '';
            oldSpan.appendChild(wrapper);
        }
    }
}

let _markedModule = null;
async function loadMarked() {
    if (_markedModule) return _markedModule;
    try {
        _markedModule = await import('https://cdn.jsdelivr.net/npm/marked/marked.esm.js');
        return _markedModule;
    } catch {
        // Fallback: basic inline rendering without marked
        _markedModule = {
            parse: (text) => `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`,
        };
        return _markedModule;
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('agent-message', AgentMessage);

export { AgentMessage };
