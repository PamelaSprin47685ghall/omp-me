function subscribeToSessionEvents(session, eventBus, sessionId) {
    return session.subscribe((event) => {
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

export { subscribeToSessionEvents };
