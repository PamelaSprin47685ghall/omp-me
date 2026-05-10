import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import buildConfirmPrompt from './run-confirm-prompt.js';
import { captureFileSnapshots, filesChanged } from './tamper-detection.js';
import { createCounter, CONFIRM_MAX_EMPTY } from './empty-turns.js';
import { buildBaseSessionOptions } from './session-options.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';
import { buildConfirmTools, emitSessionEnd } from './run-confirm-tools.js';

/**
 * Run self-confirm session reusing the worker's session file.
 * Opens the existing session via SessionManager.open(sessionFile)
 * and injects confirm + return_work tools for self-review.
 */
export async function runConfirmSession({ ctx, pi, sessionId, workerOptions, originalTask, signal, eventBus }) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }

    const { SessionManager } = await getCodingAgentModule();
    const cwd = workerOptions?.cwd || process.cwd();

    let session = null;
    let unsub = null;
    let confirmSessionId = sessionId;

    const { promise: outcomePromise, resolve: outcomeResolve } = Promise.withResolvers();
    const childAbort = new AbortController();
    let settled = false;

    const tools = buildConfirmTools(outcomeResolve, (v) => {
        settled = v;
    });

    if (signal) {
        signal.addEventListener('abort', () => childAbort.abort(), { once: true });
    }

    try {
        const options = buildBaseSessionOptions(ctx, pi, null);
        options.cwd = cwd;
        options.toolNames = ['read', 'search', 'find', 'lsp', 'bash'];
        options.customTools = tools;

        const sessionOpts = {
            ...options,
            sessionManager: await SessionManager.open(sessionId),
        };

        const factoryResult = await createAgentSession(sessionOpts);
        session = factoryResult.session;
        confirmSessionId = session.sessionFile;

        register(confirmSessionId, {
            sendUserMessage: (text) => session.prompt(text),
            session,
            status: 'confirming',
        });

        if (eventBus) {
            eventBus.emit('session', 'start', {
                sessionId: confirmSessionId,
                phase: 'confirming',
                model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
            });
            eventBus.emit('session', 'state', { sessionId: confirmSessionId, phase: 'confirming' });
            unsub = subscribeToSessionEvents(session, eventBus, confirmSessionId);
        }

        let affectedFiles = workerOptions?.affectedFiles || [];
        let snapshots = await captureFileSnapshots(affectedFiles, cwd);

        while (true) {
            const confirmPrompt = buildConfirmPrompt(originalTask);
            await session.prompt(confirmPrompt);

            const emptyCounter = createCounter(CONFIRM_MAX_EMPTY);

            while (!settled) {
                if (childAbort.signal.aborted) break;

                while (session.isStreaming) {
                    await new Promise((r) => setTimeout(r, 200));
                    if (settled || childAbort.signal.aborted) break;
                }

                if (settled || childAbort.signal.aborted) break;

                emptyCounter.increment();
                if (emptyCounter.exceeded()) {
                    throw new Error(
                        `Self-Confirm ended without calling confirm() or return_work() after ${CONFIRM_MAX_EMPTY} empty turns`,
                    );
                }

                await session.prompt(
                    'ERROR: You must call confirm() or return_work() to finish self-review. Do not output prose — call the tool.',
                );
            }

            if (!settled) return null;

            const result = await outcomePromise;

            if (result.type === 'return_work') {
                affectedFiles = result.affected_files || [];
                snapshots = await captureFileSnapshots(affectedFiles, cwd);
                if (eventBus) eventBus.emit('squad', 'confirm_resubmit', { sessionId: confirmSessionId, result });

                const changed = await filesChanged(snapshots, cwd);
                if (changed.length > 0 && eventBus) {
                    eventBus.emit('squad', 'tampered', { files: changed, sessionId: confirmSessionId });
                }

                settled = false;
                continue;
            }

            // confirm() was called — check for tampering
            const changed = await filesChanged(snapshots, cwd);
            if (changed.length > 0) {
                if (eventBus) eventBus.emit('squad', 'tampered', { files: changed, sessionId: confirmSessionId });
                snapshots = await captureFileSnapshots(affectedFiles, cwd);
                settled = false;
                continue;
            }

            emitSessionEnd(eventBus, confirmSessionId, 'completed', 'completed');
            if (eventBus) eventBus.emit('squad', 'confirm_approved', result);
            return result;
        }
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) {
            emitSessionEnd(eventBus, confirmSessionId, 'aborted', 'aborted');
            return null;
        }

        emitSessionEnd(eventBus, confirmSessionId, 'error', 'error', err.message);
        throw err;
    } finally {
        childAbort.abort();
        session?.abort?.();
        unsub?.();
        if (confirmSessionId) unregister(confirmSessionId);
    }
}
