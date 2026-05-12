import { returnTool } from '../../server/lifecycle-tools.js';

export function stubPi() {
    const commandRegistry = [];
    const toolRegistry = [];
    const eventHandlers = new Map();

    const pi = {
        _globalOnPrompt: null,
        onPrompt(callback) {
            this._globalOnPrompt = callback;
        },
        async createAgentSession(opts) {
            const messages = [];
            const subscribers = [];
            const sessionFile =
                opts.sessionManager?.getSessionFile?.() || `test-session-${Math.random().toString(36).slice(2)}`;

            // Ensure sessionManager exists and has getSessionFile
            if (!opts.sessionManager) {
                opts.sessionManager = {
                    getSessionFile: () => sessionFile,
                    cwd: opts.cwd || '.',
                };
            } else if (!opts.sessionManager.getSessionFile) {
                const originalGetSessionFile = opts.sessionManager.getSessionFile;
                opts.sessionManager.getSessionFile = () =>
                    originalGetSessionFile ? originalGetSessionFile() : sessionFile;
            }

            const session = {
                sessionFile,
                _pendingCb: null,
                _pendingText: null,
                isStreaming: false,
                async waitForIdle() {
                    // Execute the deferred prompt callback now.
                    // Models production: session.prompt() starts LLM streaming and returns
                    // immediately; the caller then await waitForIdle() for completion.
                    if (session._pendingCb) {
                        const cb = session._pendingCb;
                        const text = session._pendingText;
                        session._pendingCb = null;
                        session._pendingText = null;
                        await cb(text, session);
                    }
                },
                abort() {
                    // Drop any pending callback
                    session._pendingCb = null;
                    session._pendingText = null;
                },
                async prompt(text) {
                    messages.push({ role: 'user', content: text });
                    for (const sub of subscribers) {
                        sub({ type: 'message', message: { role: 'user', content: text } });
                    }
                    // Store callback for deferred execution by waitForIdle().
                    // In production, prompt() initiates streaming and returns immediately;
                    // isStreaming is true until the LLM finishes.
                    const cb = session._localOnPrompt || pi._globalOnPrompt;
                    if (cb) {
                        session._pendingCb = cb;
                        session._pendingText = text;
                    }
                    return { success: true };
                },
                subscribe(callback) {
                    subscribers.push(callback);
                    return () => {
                        const idx = subscribers.indexOf(callback);
                        if (idx !== -1) subscribers.splice(idx, 1);
                    };
                },
                getMessages() {
                    return messages;
                },
                onPrompt(callback) {
                    session._localOnPrompt = callback;
                },
                callTool: async (name, params) => {
                    let tool = toolRegistry.find((t) => t.name === name);
                    if (!tool && opts.customTools) {
                        tool = opts.customTools.find((t) => t.name === name);
                        if (tool) tool = { name: tool.name, def: tool };
                    }
                    if (!tool) throw new Error(`Tool not found: ${name}`);
                    const result = await tool.def.execute(params.id || 'test-call', params, null, () => {}, opts);
                    for (const sub of subscribers) {
                        sub({ type: 'tool_call', tool: name, params, result });
                    }
                    return result;
                },
            };
            return { session, dispose: () => {} };
        },
    };

    const outerApi = {
        registerCommand(name, opts) {
            commandRegistry.push({ name, opts });
        },
        registerTool(nameOrDef, def) {
            if (typeof nameOrDef === 'string') {
                toolRegistry.push({ name: nameOrDef, def });
            } else {
                toolRegistry.push({ name: nameOrDef.name, def: nameOrDef });
            }
        },
        on(event, handler) {
            if (!eventHandlers.has(event)) {
                eventHandlers.set(event, []);
            }
            eventHandlers.get(event).push(handler);
            return () => {
                const handlers = eventHandlers.get(event);
                const idx = handlers.indexOf(handler);
                if (idx !== -1) handlers.splice(idx, 1);
            };
        },
        _calls: [],
        sendMessage(msg) {
            this._calls.push({ method: 'sendMessage', args: [msg] });
        },
        sendUserMessage(text) {
            this._calls.push({ method: 'sendUserMessage', args: [text] });
        },
        setModel(model) {
            this._calls.push({ method: 'setModel', args: [model] });
        },
        getActiveTools() {
            return [];
        },
        setActiveTools(tools) {
            this._calls.push({ method: 'setActiveTools', args: [tools] });
        },
        getSessionName() {
            return 'main';
        },
        setSessionName(name) {
            this._calls.push({ method: 'setSessionName', args: [name] });
        },
        getThinkingLevel() {
            return null;
        },
        setThinkingLevel(level) {
            this._calls.push({ method: 'setThinkingLevel', args: [level] });
        },
        setStatus(status) {
            this._calls.push({ method: 'setStatus', args: [status] });
        },
        invokeTool(name, params, ctx) {
            const tool = toolRegistry.find((t) => t.name === name);
            if (!tool) throw new Error(`Tool not found: ${name}`);
            return tool.def.execute(params.id || 'test-call', params, null, () => {}, ctx);
        },
        pi,
        _commandRegistry: commandRegistry,
        _toolRegistry: toolRegistry,
        _eventHandlers: eventHandlers,
    };

    outerApi.registerTool(returnTool);
    return outerApi;
}
