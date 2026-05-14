import React, { useRef, useEffect } from 'react';
import { Box, Badge, VStack, Text } from '@chakra-ui/react';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';
import { streamingManager } from '../streaming-manager.js';

const ROLE_BG = { user: 'blue.subtle', worker: 'green.subtle', reviewer: 'orange.subtle', outer: 'bg.subtle' };
const ROLE_FG = { user: 'blue.fg', worker: 'green.fg', reviewer: 'orange.fg', outer: 'fg' };

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

export default function MessageItem({ message, sessionRole = 'user' }) {
  const isUser = message.role === 'user';
  const textRef = useRef(null);

  useEffect(() => {
    if (!message.streaming || !message.messageId || isUser) return;

    // Initial sync from buffer
    const buffer = streamingManager.getBuffer(message.messageId);
    if (textRef.current && buffer.text) {
      textRef.current.textContent = buffer.text;
    }

    return streamingManager.subscribe(message.messageId, (batch) => {
      if (batch.text && textRef.current) {
        textRef.current.textContent += batch.text;
      }
    });
  }, [message.streaming, message.messageId, isUser]);

  if (isUser) {
    return (
      <Box alignSelf="flex-end" bg="blue.subtle" borderRadius="lg" p={3} maxW="80%" overflowWrap="anywhere" data-user-msg>
        {extractText(message.content)}
      </Box>
    );
  }

  const content = message.content || [];
  const toolCalls = content.filter((block) => block.type === 'tool_call');
  const nonToolBlocks = content.filter((block) => block.type !== 'tool_call');
  const thinking = nonToolBlocks.filter((block) => block.type === 'thinking').map((block) => block.text).join('') || '';
  const text = extractText(nonToolBlocks);
  const roleBg = ROLE_BG[sessionRole] || ROLE_BG.outer;
  const roleFg = ROLE_FG[sessionRole] || ROLE_FG.outer;

  return (
    <Box bg={roleBg} color={roleFg} p={4} borderRadius="l2" overflowWrap="anywhere">
      {thinking !== undefined && <ThinkingBlock content={thinking} isStreaming={message.streaming} messageId={message.messageId} />}
      {text !== undefined && (
        <Box display="flex" alignItems="flex-start">
          {message.streaming && <Badge colorPalette="blue" mr={2} mt={1}>streaming</Badge>}
          <Text as="span" ref={textRef} whiteSpace="pre-wrap">
            {text}
          </Text>
        </Box>
      )}
      {toolCalls.length > 0 && (
        <VStack>
          {toolCalls.map((toolCall) => (
            <ToolCall key={toolCall.toolId} toolCall={toolCall} />
          ))}
        </VStack>
      )}
    </Box>
  );
}
