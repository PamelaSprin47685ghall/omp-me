import React, { useRef, useEffect } from 'react';
import { Box, Badge, VStack, Text } from '@chakra-ui/react';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';
import { eventStore } from '../event-store.js';
import { streamingManager } from '../streaming-manager.js';

const ROLE_BG = { user: 'blue.subtle', authoring: 'green.subtle', confirming: 'green.subtle', reviewing: 'orange.subtle', outer_review: 'bg.subtle' };
const ROLE_FG = { user: 'blue.fg', authoring: 'green.fg', confirming: 'green.fg', reviewing: 'orange.fg', outer_review: 'fg' };

function getTextForMessage(sessionId, messageId) {
  const state = eventStore.getState();
  const sess = state.sessions[sessionId];
  if (!sess) return '';
  const msg = sess.messages.find(m => m.messageId === messageId);
  if (!msg || !Array.isArray(msg.content)) return '';
  return msg.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

export default function MessageItem({ message, sessionRole = 'user' }) {
  const isUser = message.role === 'user';
  const textRef = useRef(null);

  useEffect(() => {
    if (!message.streaming || !message.messageId || isUser) return;

    // Initial sync from EventStore state
    if (textRef.current) {
      textRef.current.textContent = getTextForMessage(message.sessionId, message.messageId);
    }

    // Subscribe to RAF-painted repaint notifications
    return streamingManager.subscribe(message.messageId, () => {
      if (textRef.current) {
        textRef.current.textContent = getTextForMessage(message.sessionId, message.messageId);
      }
    });
  }, [message.streaming, message.messageId, isUser, message.sessionId]);

  if (isUser) {
    return (
      <Box alignSelf="flex-end" bg="blue.subtle" borderRadius="lg" p={3} maxW="80%" overflowWrap="anywhere" data-user-msg>
        {getTextForMessage(message.sessionId, message.messageId)}
      </Box>
    );
  }

  const content = message.content || [];
  const toolCalls = content.filter((block) => block.type === 'tool_call');
  const nonToolBlocks = content.filter((block) => block.type !== 'tool_call');
  const thinkingBlocks = nonToolBlocks.filter((block) => block.type === 'thinking');
  const thinking = thinkingBlocks.map((block) => block.text).join('');
  const text = getTextForMessage(message.sessionId, message.messageId);
  const roleBg = ROLE_BG[sessionRole] || ROLE_BG.outer_review;
  const roleFg = ROLE_FG[sessionRole] || ROLE_FG.outer_review;

  return (
    <Box bg={roleBg} color={roleFg} p={4} borderRadius="l2" overflowWrap="anywhere">
      {thinking !== '' && <ThinkingBlock content={thinking} isStreaming={message.streaming} messageId={message.messageId} sessionId={message.sessionId} />}
      {text !== '' && (
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
