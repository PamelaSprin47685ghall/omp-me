import React, { useState, useCallback, useRef, useEffect } from 'react';
import { HStack, Text, Badge, Collapsible, Icon, Box } from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import { eventStore } from '../event-store.js';
import { streamingManager } from '../streaming-manager.js';

export default function ThinkingBlock({ content, isStreaming = false, messageId, sessionId }) {
  const [open, setOpen] = useState(isStreaming);
  const textRef = useRef(null);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    if (!isStreaming || !messageId || !sessionId) return;

    // Initial sync from EventStore state
    if (textRef.current) {
      const state = eventStore.getState();
      const sess = state.sessions[sessionId];
      const thinking = sess?.messages?.find(m => m.messageId === messageId)?.joinedThinking || '';
      textRef.current.textContent = thinking;
    }

    return streamingManager.subscribe(messageId, () => {
      if (textRef.current) {
        const state = eventStore.getState();
        const sess = state.sessions[sessionId];
        const thinking = sess?.messages?.find(m => m.messageId === messageId)?.joinedThinking || '';
        textRef.current.textContent = thinking;
      }
    });
  }, [isStreaming, messageId, sessionId]);

  return (
    <>
      <HStack
        onClick={toggle}
        role="button"
        tabIndex={0}
        cursor="pointer"
        p={2}
        borderRadius="sm"
        _hover={{ bg: 'bg.muted' }}
        fontSize="sm"
      >
        {open ? <Icon as={ChevronDown} boxSize={3} /> : <Icon as={ChevronRight} boxSize={3} />}
        <Icon as={Lightbulb} boxSize={3} color="blue.solid" />
        <Text>Thinking</Text>
        {isStreaming && <Badge colorPalette="blue">live</Badge>}
      </HStack>
      <Collapsible.Root open={open}>
        <Collapsible.Content>
          <Box
            ref={textRef}
            as="pre"
            fontFamily="mono"
            p={3}
            bg="bg.muted"
            borderRadius="sm"
            overflowX="auto"
            fontSize="sm"
            whiteSpace="pre-wrap"
          >
            {content}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </>
  );
}
