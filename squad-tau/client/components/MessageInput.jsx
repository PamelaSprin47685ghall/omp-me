import React, { useState, useCallback } from 'react';
import { TextArea, Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export function MessageInput({ sessionId, send, onOptimisticMessage }) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId) return;
    const messageId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    onOptimisticMessage({
      sessionId,
      role: 'user',
      content: [{ type: 'text', text: trimmed }],
      messageId,
    });
    send({ type: 'session:user_message', payload: { sessionId, text: trimmed, messageId } });
    setText('');
  }, [text, sessionId, send, onOptimisticMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className="input-row">
      <TextArea
        fill
        placeholder="Type a message... (Enter to send)"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        className="input-textarea"
      />
      <Button
        intent="primary"
        icon={IconNames.SEND_MESSAGE}
        onClick={handleSend}
        disabled={!text.trim()}
      />
    </div>
  );
}
