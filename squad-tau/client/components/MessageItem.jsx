import React from 'react';
import { Box, Badge, Alert } from '@chakra-ui/react';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';

const ROLE_STATUS = { user: 'info', worker: 'success', reviewer: 'warning', outer: 'neutral' };

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

function UserMessage({ message }) {
  return (
    <Box alignSelf="flex-end" overflow="hidden" data-user-msg>
      <Box
        bg="blue.50"
        _dark={{ bg: 'blue.900' }}
        borderRadius="lg"
        p={3}
        maxWidth="80%"
        wordBreak="break-word"
        overflowWrap="anywhere"
      >
        {extractText(message.content)}
      </Box>
    </Box>
  );
}

function AssistantMessage({ message, sessionRole }) {
  const content = message.content || [];
  const toolCalls = content.filter((block) => block.type === 'tool_call');
  const nonToolBlocks = content.filter((block) => block.type !== 'tool_call');
  const thinking = nonToolBlocks.filter((block) => block.type === 'thinking').map((block) => block.text).join('') || '';
  const text = extractText(nonToolBlocks);
  const status = ROLE_STATUS[sessionRole] || 'neutral';

  return (
    <Alert.Root
      status={status}
      p={4}
      flexDirection="column"
      alignItems="flex-start"
      wordBreak="break-word"
      overflowWrap="anywhere"
      gap={4}
    >
      {thinking && <ThinkingBlock content={thinking} isStreaming={message.streaming} />}
      {text && (
        <Box>
          {message.streaming && (
            <Badge colorScheme="blue" variant="subtle" borderRadius="full" mr={2}>streaming</Badge>
          )}
          {text}
        </Box>
      )}
      {toolCalls.length > 0 && (
        <Box display="flex" flexDirection="column" gap={3}>
          {toolCalls.map((toolCall) => (
            <ToolCall key={toolCall.toolId} toolCall={toolCall} sessionRole={sessionRole} />
          ))}
        </Box>
      )}
    </Alert.Root>
  );
}

export default function MessageItem({ message, sessionRole = 'user' }) {
  return (
    <Box display="flex" flexDirection="column" justifyContent={message.role === 'user' ? 'flex-end' : 'inherit'}>
      {message.role === 'user' ? <UserMessage message={message} /> : <AssistantMessage message={message} sessionRole={sessionRole} />}
    </Box>
  );
}
