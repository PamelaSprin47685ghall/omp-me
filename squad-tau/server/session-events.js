import { Events } from '../shared/events.js';

function subscribeToSessionEvents(session, eventLog, sessionId) {
    return session.subscribe((event) => {
        try {
            if (event.type === 'message_update') {
                handleMessageUpdate(event, eventLog, sessionId);
            } else if (event.type === 'tool_execution_start') {
                handleToolStart(event, eventLog, sessionId);
            } else if (event.type === 'tool_execution_end') {
                handleToolEnd(event, eventLog, sessionId);
            } else if (event.type === 'message_end') {
                handleMessageEnd(event, eventLog, sessionId);
            }
        } catch (err) {
            console.error(`[SessionEvents] Error handling event ${event.type} for ${sessionId}:`, err);
        }
    });
}

function handleMessageUpdate(event, eventLog, sessionId) {
    const assistantEvent = event.assistantMessageEvent;
    if (!assistantEvent || !event.message || !event.message.id) return;
    if (assistantEvent.type === 'text_delta') {
        eventLog.append(Events.SESSION_MESSAGE_DELTA, {
            sessionId,
            messageId: event.message.id,
            delta: { type: 'text_delta', text: assistantEvent.delta },
        });
    } else if (assistantEvent.type === 'thinking_delta') {
        eventLog.append(Events.SESSION_MESSAGE_DELTA, {
            sessionId,
            messageId: event.message.id,
            delta: { type: 'thinking_delta', text: assistantEvent.delta },
        });
    }
}

function handleToolStart(event, eventLog, sessionId) {
    eventLog.append(Events.SESSION_TOOL_CALL, {
        sessionId,
        toolName: event.toolName,
        toolId: event.toolId,
        params: event.input,
    });
}

function handleToolEnd(event, eventLog, sessionId) {
    eventLog.append(Events.SESSION_TOOL_RESULT, {
        sessionId,
        toolId: event.toolId,
        result: event.result,
        isError: event.isError || false,
    });
}

function handleMessageEnd(event, eventLog, sessionId) {
    eventLog.append(Events.SESSION_MESSAGE, {
        sessionId,
        role: event.message.role,
        content: event.message.content,
        messageId: event.message.id,
        parentId: event.message.parentId,
    });
}

export { subscribeToSessionEvents };
