import React, { useState, useCallback } from 'react';
import { HStack, Text, Badge, Collapsible, Icon, Box } from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';

export default function ThinkingBlock({ content, isStreaming = false }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);

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
