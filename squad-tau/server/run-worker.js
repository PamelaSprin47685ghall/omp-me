import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt } from './run-worker-prompt.js';
import { captureFileSnapshots } from './tamper-detection.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildReturnWorkTool } from './lifecycle-tools.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister } from './session-registry.js';

async function runWorker({ node, upstreamResults, reviewerFeedback, ctx, pi, signal, eventBus, modelSlot }) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }

    const { SessionManager } = await getCodingAgentModule();

    const options = buildWorkerSessionOptions(ctx, pi, modelSlot);
    const promptText = buildWorkerPrompt(node, upstreamResults, reviewerFeedback);

    const { promise: workPromise, resolve: workResolve } = Promise.withResolvers();

    const childAbort = new AbortController();
    let settled = false;

    const returnWorkTool = buildReturnWorkTool((result) => {
        settled = true;
        workResolve(result);
    });

    if (signal) {
        signal.addEventListener(
            'abort',
            () => {
                childAbort.abort();
            },
            { once: true },
        );
    }

    let session = null;
    let unsub = null;
    let sessionId = null;

    try {
        const sessionOpts = {
            ...options,
            customTools: [returnWorkTool],
            sessionManager: SessionManager.create(options.cwd),
        };

        const factoryResult = await createAgentSession(sessionOpts);
        session = factoryResult.session;
        sessionId = session.sessionFile;

        register(sessionId, {
            sendUserMessage: (text) => session.prompt(text),
            session,
            status: 'authoring',
        });

        if (eventBus) {
            eventBus.emit('session', 'start', {
                sessionId,
                nodeId: node.id,
                phase: 'worker',
                model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
            });

            unsub = session.subscribe((event) => {
                if (event.type === 'message_update') {
                    const assistantEvent = event.assistantMessageEvent;
                    if (assistantEvent.type === 'text_delta') {
                        eventBus.emit('session', 'message_delta', {
                            sessionId,
                            messageId: event.message.id,
                            delta: {
                                type: 'text_delta',
                                text: assistantEvent.delta,
                            },
                        });
                    } else if (assistantEvent.type === 'thinking_delta') {
                        eventBus.emit('session', 'message_delta', {
                            sessionId,
                            messageId: event.message.id,
                            delta: {
                                type: 'thinking_delta',
                                text: assistantEvent.delta,
                            },
                        });
                    }
                } else if (event.type === 'tool_execution_start') {
                    eventBus.emit('session', 'tool_call', {
                        sessionId,
                        toolName: event.toolName,
                        toolId: event.toolCallId,
                        params: event.args,
                    });
                } else if (event.type === 'tool_execution_end') {
                    eventBus.emit('session', 'tool_result', {
                        sessionId,
                        toolId: event.toolCallId,
                        result: event.result,
                        isError: event.isError || false,
                    });
                } else if (event.type === 'message_end') {
                    eventBus.emit('session', 'message', {
                        sessionId,
                        role: event.message.role,
                        content: event.message.content,
                        messageId: event.message.id,
                        parentId: event.message.parentId,
                    });
                }
            });
        }

        await session.prompt(promptText);

        const emptyCounter = createCounter(MAX_EMPTY_TURNS);

        while (!settled) {
            if (childAbort.signal.aborted) break;

            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (settled || childAbort.signal.aborted) break;
            }

            if (settled || childAbort.signal.aborted) break;

            emptyCounter.increment();
            if (emptyCounter.exceeded()) {
                throw new Error(`Worker ended without calling return_work after ${MAX_EMPTY_TURNS} empty turns`);
            }

            await session.prompt(
                'ERROR: You must call the required tool to finish this session. Do not output prose — call the tool.',
            );
        }

        if (!settled) {
            return null;
        }

        const workerResult = await workPromise;

        const snapshots = await captureFileSnapshots(workerResult.affected_files || [], options.cwd);

        if (eventBus) {
            eventBus.emit('session', 'end', {
                sessionId,
                reason: 'completed',
            });
        }

        return {
            ...workerResult,
            sessionFile: session.sessionFile,
            session,
            fileSnapshots: snapshots,
        };
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) {
            if (eventBus && sessionId) {
                eventBus.emit('session', 'end', {
                    sessionId,
                    reason: 'aborted',
                });
            }
            return null;
        }

        if (eventBus && sessionId) {
            eventBus.emit('session', 'end', {
                sessionId,
                reason: 'error',
                errorMessage: err.message,
            });
        }

        throw err;
    } finally {
        childAbort.abort();
        session?.abort?.();
        unsub?.();
        if (sessionId) {
            unregister(sessionId);
        }
    }
}

export { runWorker };
