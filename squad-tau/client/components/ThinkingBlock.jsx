import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Badge } from '@chakra-ui/react';
import Collapse from './Collapse.jsx';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';

export default function ThinkingBlock({ content, isStreaming = false }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  return (
    <Box>
      <Flex
        onClick={toggle}
        role="button"
        tabIndex={0}
        cursor="pointer"
        p={2}
        alignItems="center"
        gap={2}
        borderRadius="sm"
        _hover={{ bg: 'blackAlpha.50' }}
        _dark={{ _hover: { bg: 'whiteAlpha.50' } }}
        fontSize="sm"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Lightbulb size={12} color="var(--chakra-colors-blue-500)" />
        <Text>Thinking</Text>
        {isStreaming && <Badge colorScheme="blue" variant="subtle" borderRadius="full" px={2}>live</Badge>}
      </Flex>
      <Collapse in={open} animateOpacity>
        <Box
          as="pre"
          fontFamily="mono"
          p={3}
          m={0}
          bg="blackAlpha.50"
          _dark={{ bg: 'whiteAlpha.100' }}
          borderRadius="sm"
          overflowX="auto"
          fontSize="sm"
          whiteSpace="pre-wrap"
        >
          {content}
        </Box>
      </Collapse>
    </Box>
  );
}
