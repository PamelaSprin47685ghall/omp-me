import React, { useState, useCallback } from 'react';
import { Button, ControlGroup, TextArea } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export function MessageInput({ sessionId, send, onOptimisticMessage }) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId) return;
    const tempId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    onOptimisticMessage({
      sessionId,
      role: 'user',
      content: [{ type: 'text', text: trimmed }],
      messageId: tempId,
    });
    send({ type: 'session:user_message', payload: { sessionId, text: trimmed, messageId: tempId } });
    setText('');
  }, [text, sessionId, send, onOptimisticMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className="bp6-padding" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <TextArea
        fill
        growVertically
        placeholder="Type a message... (Enter to send)"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{ flex: 1, minHeight: 40, maxHeight: 200 }}
      />
      <Button
        intent="primary"
        icon={IconNames.SEND_MESSAGE}
        text="Send"
        onClick={handleSend}
        disabled={!text.trim()}
      />
    </div>
  );
}
