import React, { useState, useCallback, useRef, useEffect } from 'react';
import { HStack, Text, Badge, Collapsible, Icon, Box } from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import { streamingManager } from '../streaming-manager.js';

export default function ThinkingBlock({ content, isStreaming = false, messageId }) {
  const [open, setOpen] = useState(isStreaming);
  const textRef = useRef(null);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    if (!isStreaming || !messageId) return;
    
    // Initial sync from buffer
    const buffer = streamingManager.getBuffer(messageId);
    if (textRef.current && buffer.thinking) {
      textRef.current.textContent = buffer.thinking;
    }

    return streamingManager.subscribe(messageId, (batch) => {
      if (batch.thinking && textRef.current) {
        textRef.current.textContent += batch.thinking;
      }
    });
  }, [isStreaming, messageId]);

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
