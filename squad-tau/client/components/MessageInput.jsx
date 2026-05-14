import React, { useState, useCallback } from 'react';
import { Button, Flex, Textarea } from '@chakra-ui/react';
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
    <Flex gap={3} alignItems="flex-end">
      <Textarea
        flex={1}
        placeholder="Type a message... (Enter to send)"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        minHeight={12}
        maxHeight={56}
        resize="vertical"
      />
      <Button
        colorScheme="blue"
        leftIcon={<SendHorizonal />}
        onClick={handleSend}
        disabled={!text.trim()}
      >
        Send
      </Button>
    </Flex>
  );
}
