import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Center, Text, VStack, IconButton, Icon } from '@chakra-ui/react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { usePathState, useSessionMessageIds } from '../hooks/useAtomicState.js';
import MessageItem from './MessageItem.jsx';

const SCROLL_BOTTOM_THRESHOLD = 40;

export default function MessageList() {
  const activeSessionId = usePathState('ui', s => s.ui?.activeSessionId);
  const messageIds = useSessionMessageIds(activeSessionId);
  const sessionRole = usePathState('messages', s => {
    if (!activeSessionId) return 'user';
    return s.sessions[activeSessionId]?.phase || 'user';
  });

  const containerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  // Passive scroll listener for "scroll to bottom" button visibility
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD;
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  if (!messageIds?.length) {
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
      style={{ overflowAnchor: 'auto' }}
    >
      {messageIds.map((msgId) => (
        <MessageItem
          key={msgId}
          messageId={msgId}
          sessionRole={sessionRole}
        />
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
      <div style={{ overflowAnchor: 'auto', height: 1, flexShrink: 0 }} />
    </VStack>
  );
}
