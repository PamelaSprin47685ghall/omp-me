function subscribeToSessionEvents(session, eventBus, sessionId) {
    return session.subscribe((event) => {
        try {
            if (event.type === 'message_update') {
                handleMessageUpdate(event, eventBus, sessionId);
            } else if (event.type === 'tool_execution_start') {
                handleToolStart(event, eventBus, sessionId);
            } else if (event.type === 'tool_execution_end') {
                handleToolEnd(event, eventBus, sessionId);
            } else if (event.type === 'message_end') {
                handleMessageEnd(event, eventBus, sessionId);
            }
        } catch (err) {
            console.error(`[SessionEvents] Error handling event ${event.type} for ${sessionId}:`, err);
        }
    });
}

function handleMessageUpdate(event, eventBus, sessionId) {
    const assistantEvent = event.assistantMessageEvent;
    if (!assistantEvent) return;
    if (assistantEvent.type === 'text_delta') {
        eventBus.emit('session', 'message_delta', {
            sessionId,
            messageId: event.message.id,
            delta: { type: 'text_delta', text: assistantEvent.delta },
        });
    } else if (assistantEvent.type === 'thinking_delta') {
        eventBus.emit('session', 'message_delta', {
            sessionId,
            messageId: event.message.id,
            delta: { type: 'thinking_delta', text: assistantEvent.delta },
        });
    }
}

function handleToolStart(event, eventBus, sessionId) {
    eventBus.emit('session', 'tool_call', {
        sessionId,
        toolName: event.toolName,
        toolId: event.toolId,
        params: event.input,
    });
}

function handleToolEnd(event, eventBus, sessionId) {
    eventBus.emit('session', 'tool_result', {
        sessionId,
        toolId: event.toolId,
        result: event.result,
        isError: event.isError || false,
    });
}

function handleMessageEnd(event, eventBus, sessionId) {
    eventBus.emit('session', 'message', {
        sessionId,
        role: event.message.role,
        content: event.message.content,
        messageId: event.message.id,
        parentId: event.message.parentId,
    });
}

export { subscribeToSessionEvents };
