export function stubPi() {
    const commandRegistry = [];
    const toolRegistry = [];
    const eventHandlers = new Map();

    return {
        registerCommand(name, opts) {
            commandRegistry.push({ name, opts });
        },
        registerTool(name, def) {
            toolRegistry.push({ name, def });
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
        sendMessage() {},
        sendUserMessage() {},
        setModel() {},
        getActiveTools() {
            return [];
        },
        setActiveTools() {},
        getSessionName() {
            return 'main';
        },
        setSessionName() {},
        getThinkingLevel() {
            return null;
        },
        setThinkingLevel() {},
        setStatus() {},
        pi: {
            async createAgentSession(opts) {
                const messages = [];
                const subscribers = [];
                const session = {
                    async prompt(text) {
                        messages.push({ role: 'user', content: text });
                        for (const sub of subscribers) {
                            sub({ type: 'message', message: { role: 'user', content: text } });
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
                };
                return { session, dispose: () => {} };
            },
        },
        _commandRegistry: commandRegistry,
        _toolRegistry: toolRegistry,
        _eventHandlers: eventHandlers,
    };
}
