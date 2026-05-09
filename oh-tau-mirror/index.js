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

export default async function ohTauMirrorAdaptor(pi) {
    // Resolve tau-mirror's extension entry from the npm-installed package.
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const extPath = join(__dirname, 'node_modules', 'tau-mirror', 'extensions', 'mirror-server.ts');

    // Capture tau-mirror's port from setStatus, then rewrite to proxy port
    const origOn = pi.on.bind(pi);
    pi.on = function (event, handler) {
        if (event !== 'session_start') return origOn(event, handler);
        return origOn(event, async (evt, ctx) => {
            const sf = ctx?.sessionManager?.getSessionFile?.();
            proxy.addSessionFile(sf);

            const proxyPortP = interceptPort(ctx);
            await handler(evt, ctx);

            // After proxy is confirmed listening, update display to show proxy port
            if (proxyPortP) {
                const actualPort = await proxyPortP;
                if (actualPort && ctx?.ui) {
                    const status = ctx.ui.setStatus;
                    status('mirror', `Mirror: 127.0.0.1:${actualPort}`);
                    ctx.ui.notify?.(`Tau mirror: http://127.0.0.1:${actualPort}  •  /qr for QR code`, 'info');
                }
            }
        });
    };

    const { default: tauMirrorExtension } = await import('file://' + extPath);

    const bridge = createBridge(pi);
    tauMirrorExtension(bridge);

    pi.on = origOn;
}

function interceptPort(ctx) {
    const us = ctx?.ui;
    if (!us || !us.setStatus) return null;
    const origSetStatus = us.setStatus.bind(us);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        
        us.setStatus = (key, text) => {
            if (key === 'mirror' && text) {
                const m = text.match(/:\d+/);
                if (m) {
                    const tauP = parseInt(m[0].slice(1));
                    clearTimeout(timeout);
                    const p = proxy.setTauPort(tauP);
                    if (p) p.then((port) => resolve(port));
                    else resolve(null);
                }
            }
            return origSetStatus(key, text);
        };
    });
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
                const sf = ctx?.sessionManager?.getSessionFile?.();
                proxy.addSessionFile(sf);

                // Tag event with session file for multi-session routing in the browser
                if (evt && typeof evt === 'object' && sf) {
                    evt.__sessionFile = sf;
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
