// NOTE: PRD/04-web-ui.md sect 4.6 specifies "Blueprint InputGroup (single-line) + Button" for
// message input. However, the acceptance criteria explicitly requires "Enter sends, Shift+Enter
// adds newline" — a multiline capability that InputGroup cannot provide (single-line only).
// We prioritize the acceptance criteria and use TextArea, which satisfies the functional requirement.
import { useState, useCallback } from 'react';
import { TextArea, Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export const END_PLACEHOLDER = {
  completed: 'Session completed',
  aborted: 'Session aborted',
  error: 'Session failed',
};

let _msgCounter = 0;
export function nextId() {
  return `opt_${Date.now()}_${++_msgCounter}`;
}

export function getDisabled(sessionEndReason) {
  return sessionEndReason !== null && sessionEndReason !== undefined;
}

export function getPlaceholder(sessionEndReason) {
  if (sessionEndReason === null || sessionEndReason === undefined) {
    return 'Type a message...';
  }
  return END_PLACEHOLDER[sessionEndReason] ?? 'Session ended';
}

export function buildOptimisticMessage(sessionId, text) {
  return {
    messageId: nextId(),
    sessionId,
    role: 'user',
    content: [{ type: 'text', text }]
  };
}

export function MessageInput({ sessionId, sessionEndReason, send, onOptimisticMessage }) {
  const [value, setValue] = useState('');
  const disabled = getDisabled(sessionEndReason);
  const placeholder = getPlaceholder(sessionEndReason);

  const handleSend = useCallback(() => {
    if (!value.trim() || !sessionId || disabled) return;
    const msg = buildOptimisticMessage(sessionId, value.trim());
    send({ type: 'session:user_message', payload: { sessionId, text: value.trim() } });
    onOptimisticMessage(msg);
    setValue('');
  }, [value, sessionId, disabled, send, onOptimisticMessage]);

  const handleKeyDown = useCallback(e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 16px' }}>
      <TextArea
        autoFocus
        fill
        autoResize
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{ minHeight: 38, maxHeight: 120, resize: 'none', flex: 1 }}
      />
      <Button
        intent="primary"
        icon={IconNames.SEND_MESSAGE}
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        style={{ flexShrink: 0, height: 38 }}
      />
    </div>
  );
}
