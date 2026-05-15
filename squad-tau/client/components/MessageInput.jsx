import React, { useState, useCallback } from 'react';
import { Button, HStack, Textarea, Icon } from '@chakra-ui/react';
import { SendHorizonal } from 'lucide-react';
import { usePathState } from '../hooks/useAtomicState.js';
import { eventStore } from '../event-store.js';
import { useWebSocketContext } from '../websocket-context.js';

export function MessageInput() {
  const [text, setText] = useState('');
  const { send } = useWebSocketContext();
  const activeSessionId = usePathState('ui', s => s.ui?.activeSessionId);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId) return;
    const tempId = `usr_${Date.now()}`;

    // Create message entity in EventStore for React rendering
    eventStore.dispatch('message:created', {
      messageId: tempId,
      sessionId: activeSessionId,
      role: 'user',
      staticContent: trimmed,
    });

    send({ type: 'session:user_message', payload: { sessionId: activeSessionId, text: trimmed, messageId: tempId } });
    setText('');
  }, [text, activeSessionId, send]);

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
