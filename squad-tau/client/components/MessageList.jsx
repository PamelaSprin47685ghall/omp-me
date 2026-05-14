import React, { useRef } from 'react';
import { Center, Text, VStack, IconButton, Icon } from '@chakra-ui/react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import MessageItem from './MessageItem.jsx';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

export default function MessageList({ messages, sessionRole, ...rest }) {
  const containerRef = useRef(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(containerRef, messages);

  if (!messages?.length) {
    return (
      <Center ref={containerRef} overflowY="auto" p={4} flexDirection="column" gap={4} py={12} color="fg.subtle" {...rest}>
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
      {...rest}
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
