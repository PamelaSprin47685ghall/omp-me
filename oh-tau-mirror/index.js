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

import * as proxy from './proxy.js';
const { importNodeModule } = await import('@oh-my-pi/resolve-pi');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const UNSUPPORTED_EVENTS = new Set(['model_select']);

let mainEventBus = null;
let unsubEventBus = null;

export default async function ohTauMirrorAdaptor(pi) {
    const { default: tauMirrorExtension } = await importNodeModule('tau-mirror', 'extensions/mirror-server.ts');

    const origOn = pi.on.bind(pi);
    pi.on = function (event, handler) {
        if (event !== 'session_start') return origOn(event, handler);
        return origOn(event, async (evt, ctx) => {
            const sf = ctx?.sessionManager?.getSessionFile?.();
            proxy.addSessionFile(sf);

            if (pi?.events && pi.events !== mainEventBus) {
                unsubEventBus?.();
                mainEventBus = pi.events;
                unsubEventBus = mainEventBus.on('squad:subagent:stream', (data) => {
                    if (data?.event && data?.sessionFile) {
                        proxy.forwardSubagentEvent(data.event, data.sessionFile);
                    }
                });
            }

            const proxyPortP = interceptPort(ctx);
            await handler(evt, ctx);

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

export function createBridge(pi) {
    let lastSessionFile = null;
    const CATALOG_REFRESH_EVENTS = new Set(['message_end', 'turn_end']);

    return {
        registerCommand(name, opts) {
            pi.registerCommand(name, opts);
        },

        on(event, handler) {
            if (UNSUPPORTED_EVENTS.has(event)) return;
            pi.on(event, (evt, ctx) => {
                const sf = ctx?.sessionManager?.getSessionFile?.();

                if (sf) {
                    const isNewSession = sf !== lastSessionFile;
                    const isCatalogEvent = CATALOG_REFRESH_EVENTS.has(event);
                    if (isNewSession) {
                        lastSessionFile = sf;
                        proxy.addSessionFile(sf);
                    } else if (isCatalogEvent) {
                        proxy.addSessionFile(sf);
                    }
                }

                if (event === 'message_start' && evt?.message?.role === 'user') {
                    proxy.activateSessionFile(sf);
                }

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
