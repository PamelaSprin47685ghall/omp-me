import React, { useState, useCallback } from 'react';
import { HStack, Text, Badge, Collapsible, Icon, Box } from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Code } from 'lucide-react';

export default function ToolCall({ toolCall }) {
  const { toolName, params, result, isError } = toolCall;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const hasResult = result !== undefined;
  const preview = !params ? ''
    : params.path || (typeof params.command === 'string' ? params.command.slice(0, 80)
    : (typeof params.query === 'string' ? params.query.slice(0, 60)
    : params.url || Object.values(params).find(v => typeof v === 'string' && v.length > 0)?.slice(0, 60) || ''));

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
        <Icon as={Code} boxSize={3} />
        <Text as="span" fontFamily="mono">{toolName}</Text>
        {preview && (
          <Text
            flex={1}
            truncate
            color="fg.subtle"
          >
            {preview}
          </Text>
        )}
        <HStack>
          {isError && <Badge colorPalette="red">error</Badge>}
          {hasResult && !isError && <Badge colorPalette="green">done</Badge>}
          {!hasResult && <Badge>running</Badge>}
        </HStack>
      </HStack>
      <Collapsible.Root open={open}>
        <Collapsible.Content>
          {params && Object.keys(params).length > 0 && (
            <Box
              as="pre"
              fontFamily="mono"
              p={3}
              bg="bg.muted"
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
              bg={isError ? 'bg.error' : 'bg.muted'}
              borderRadius="sm"
              overflowX="auto"
              color={isError ? 'fg.error' : 'inherit'}
              fontSize="sm"
            >
              {!result ? '' : (Array.isArray(result) ? result.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n') : (result.content && Array.isArray(result.content) ? result.content.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n') : JSON.stringify(result, null, 2)))}
            </Box>
          )}
        </Collapsible.Content>
      </Collapsible.Root>
    </>
  );
}
