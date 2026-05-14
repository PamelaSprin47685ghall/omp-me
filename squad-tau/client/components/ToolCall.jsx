import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Badge } from '@chakra-ui/react';
import Collapse from './Collapse.jsx';
import { ChevronDown, ChevronRight, Code } from 'lucide-react';

function argsPreview(toolName, params) {
  if (!params) return '';
  if (params.path) return params.path;
  if (typeof params.command === 'string') return params.command.slice(0, 80);
  if (typeof params.query === 'string') return params.query.slice(0, 60);
  if (params.url) return params.url;
  const first = Object.values(params).find((value) => typeof value === 'string' && value.length > 0);
  return first ? first.slice(0, 60) : '';
}

function formatResult(result) {
  if (!result) return '';
  if (Array.isArray(result)) return result.map((block) => (block.type === 'text' ? block.text : JSON.stringify(block))).join('\n');
  if (result.content && Array.isArray(result.content)) {
    return result.content.map((block) => (block.type === 'text' ? block.text : JSON.stringify(block))).join('\n');
  }
  return JSON.stringify(result, null, 2);
}

export default function ToolCall({ toolCall }) {
  const { toolName, params, result, isError } = toolCall;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const hasResult = result !== undefined;
  const preview = argsPreview(toolName, params);

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
        <Code size={12} />
        <Text as="span" fontFamily="mono">{toolName}</Text>
        {preview && (
          <Text
            flex={1}
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            color="gray.500"
            _dark={{ color: 'gray.400' }}
          >
            {preview}
          </Text>
        )}
        <Box display="flex" gap={2}>
          {isError && <Badge colorScheme="red" variant="subtle" borderRadius="full" px={2}>error</Badge>}
          {hasResult && !isError && <Badge colorScheme="green" variant="subtle" borderRadius="full" px={2}>done</Badge>}
          {!hasResult && <Badge variant="subtle" borderRadius="full" px={2}>running</Badge>}
        </Box>
      </Flex>
      <Collapse in={open} animateOpacity>
        {params && Object.keys(params).length > 0 && (
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
          >
            {JSON.stringify(params, null, 2)}
          </Box>
        )}
        {hasResult && (
          <Box
            as="pre"
            fontFamily="mono"
            p={3}
            m={0}
            bg={isError ? 'red.50' : 'blackAlpha.50'}
            _dark={{ bg: isError ? 'red.950' : 'whiteAlpha.100' }}
            borderRadius="sm"
            overflowX="auto"
            color={isError ? 'red.600' : 'inherit'}
            _dark={{ color: isError ? 'red.400' : 'inherit' }}
            fontSize="sm"
          >
            {formatResult(result)}
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
