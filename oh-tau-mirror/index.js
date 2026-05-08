/**
 * oh-tau-mirror — oh-my-pi extension adaptor for tau-mirror
 *
 * Loads tau-mirror as-is. A MITM proxy (proxy.js) sits between the
 * browser and tau-mirror to add multi-session event routing.
 *
 * The only intrusions into the host process:
 *   1. Suppress tau-mirror's console noise (clutters TUI)
 *   2. Track process-local session files for /api/sessions filtering
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as proxy from './proxy.js';

// ---------------------------------------------------------------------------
// Suppress tau-mirror's console noise entirely
// ---------------------------------------------------------------------------

console.log = () => {};
console.warn = () => {};
console.error = () => {};

// ---------------------------------------------------------------------------
// Events that exist in the original @mariozechner/pi-coding-agent ExtensionAPI
// but have no direct equivalent in oh-my-pi's ExtensionAPI.
// ---------------------------------------------------------------------------

const UNSUPPORTED_EVENTS = new Set(['model_select']);

/** All session files seen by this process via forwarded events. */
const processSessions = new Set();
proxy.setProcessSessions(processSessions);

/** Latest session file captured from any forwarded Pi event (for WS tagging). */
let latestSessionFile = null;

export default async function ohTauMirrorAdaptor(pi) {
  // Resolve tau-mirror's extension entry from the npm-installed package.
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const extPath = join(__dirname, 'node_modules', 'tau-mirror', 'extensions', 'mirror-server.ts');

  // Intercept ctx.ui.setStatus to capture tau-mirror's port
  const origOn = pi.on.bind(pi);
  pi.on = function (event, handler) {
    if (event !== 'session_start') return origOn(event, handler);
    return origOn(event, async (evt, ctx) => {
      interceptPort(ctx);
      const sf = ctx?.sessionManager?.getSessionFile?.();
      if (sf) processSessions.add(sf);

      await handler(evt, ctx);
    });
  };

  const { default: tauMirrorExtension } = await import('file://' + extPath);

  const bridge = createBridge(pi);
  tauMirrorExtension(bridge);

  pi.on = origOn;
}

function interceptPort(ctx) {
  if (proxy.getProxyStatus()) return; // already running
  const us = ctx?.ui;
  if (!us || !us.setStatus) return;
  const origSetStatus = us.setStatus.bind(us);
  us.setStatus = (key, text) => {
    if (key === 'mirror' && text) {
      const m = text.match(/:(\d+)/);
      if (m) proxy.setTauPort(parseInt(m[1]));
    }
    return origSetStatus(key, text);
  };
}

/**
 * Create a bridge from oh-my-pi ExtensionAPI to the original
 * @mariozechner/pi-coding-agent ExtensionAPI that tau-mirror expects.
 */
export function createBridge(pi) {
  return {
    registerCommand(name, opts) {
      pi.registerCommand(name, opts);
    },

    on(event, handler) {
      if (UNSUPPORTED_EVENTS.has(event)) return;
      pi.on(event, (evt, ctx) => {
        latestSessionFile = ctx?.sessionManager?.getSessionFile?.() || null;
        const sf = ctx?.sessionManager?.getSessionFile?.();
        if (sf) processSessions.add(sf);

        // Tag event with session file for proxy injection into WS messages
        if (evt && typeof evt === 'object' && latestSessionFile) {
          evt.__sessionFile = latestSessionFile;
        }

        return handler(evt, ctx);
      });
    },

    sendUserMessage(content, opts) {
      pi.sendUserMessage(content, opts);
    },

    setModel(model) {
      return pi.setModel(model);
    },

    getSessionName() {
      return pi.getSessionName();
    },

    setSessionName(name) {
      return pi.setSessionName(name);
    },

    getThinkingLevel() {
      return pi.getThinkingLevel();
    },

    setThinkingLevel(level) {
      pi.setThinkingLevel(level);
    },
  };
}
