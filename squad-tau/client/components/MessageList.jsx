import React, { useRef } from 'react';
import { Center, Text, VStack, IconButton, Icon } from '@chakra-ui/react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { usePathState } from '../hooks/useAtomicState.js';
import MessageItem from './MessageItem.jsx';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

export default function MessageList() {
  const activeSessionId = usePathState('ui', s => s.ui?.activeSessionId);
  const messages = usePathState('sessions', s => {
    if (!activeSessionId) return [];
    const sess = s.sessions[activeSessionId];
    return sess?.messages || [];
  });
  const sessionRole = usePathState('sessions', s => {
    if (!activeSessionId) return 'user';
    return s.sessions[activeSessionId]?.phase || 'user';
  });

  const containerRef = useRef(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(containerRef, messages);

  if (!messages?.length) {
    return (
      <Center ref={containerRef} overflowY="auto" p={4} flexDirection="column" gap={4} py={12} color="fg.subtle" flex={1} minH={0}>
        <Icon as={MessageCircle} boxSize={8} />
        <Text>No messages yet</Text>
      </Center>
    );
  }

  return (
    <VStack
      ref={containerRef}
      overflowY="auto"
      p={4}
      gap={5}
      align="stretch"
      flex={1}
      minH={0}
    >
      {messages.map((msg) => (
        <MessageItem key={msg.messageId} message={msg} sessionRole={sessionRole} />
      ))}
      {!isAtBottom && (
          <IconButton
            aria-label="Scroll to latest"
            variant="outline"
            size="sm"
            borderRadius="full"
            onClick={scrollToBottom}
          >
            <Icon as={ArrowDown} boxSize={4} />
          </IconButton>
      )}
    </VStack>
  );
}
