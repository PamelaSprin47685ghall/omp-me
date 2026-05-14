import React, { useState, useCallback } from 'react';
import { Button, HStack, Textarea, Icon } from '@chakra-ui/react';
import { SendHorizonal } from 'lucide-react';

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
    <HStack alignItems="flex-end">
      <Textarea
        flex={1}
        placeholder="Type a message... (Enter to send)"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        minH={12}
        maxH={56}
        resize="vertical"
      />
      <Button
        colorPalette="blue"
        onClick={handleSend}
        disabled={!text.trim()}
      >
        <Icon as={SendHorizonal} boxSize={4} />
        Send
      </Button>
    </HStack>
  );
}
