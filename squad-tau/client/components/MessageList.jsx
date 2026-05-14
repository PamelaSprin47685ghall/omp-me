import React, { useRef } from 'react';
import { Box, Center, Text, IconButton } from '@chakra-ui/react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import MessageItem from './MessageItem.jsx';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

export default function MessageList({ messages, sessionRole }) {
  const containerRef = useRef(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(containerRef, messages);

  if (!messages?.length) {
    return (
      <Box ref={containerRef} overflowY="auto" p={4} h="full">
        <Center flexDirection="column" gap={4} py={12} color="gray.500" _dark={{ color: 'gray.400' }}>
          <MessageCircle size={32} />
          <Text>No messages yet</Text>
        </Center>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      overflowY="auto"
      p={4}
      h="full"
      display="flex"
      flexDirection="column"
      gap={5}
    >
      {messages.map((msg) => (
        <MessageItem key={msg.messageId} message={msg} sessionRole={sessionRole} />
      ))}
      {!isAtBottom && (
        <Box className="scroll-down-wrap">
          <IconButton
            aria-label="Scroll to latest"
            icon={<ArrowDown size={16} />}
            variant="outline"
            size="sm"
            borderRadius="full"
            onClick={scrollToBottom}
          />
        </Box>
      )}
    </Box>
  );
}
