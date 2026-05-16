import React from 'react';
import { Box } from '@chakra-ui/react';
import { useMessageState } from '../hooks/useAtomicState.js';
import ToolCall from './ToolCall.jsx';
import '../components/stream-sink.js';

const ROLE_BG = { user: 'blue.subtle', authoring: 'green.subtle', confirming: 'green.subtle', reviewing: 'orange.subtle', outer_review: 'bg.subtle' };
const ROLE_FG = { user: 'blue.fg', authoring: 'green.fg', confirming: 'green.fg', reviewing: 'orange.fg', outer_review: 'fg' };

/**
 * MessageItem — renders either:
 *   1. Static user message
 *   2. Assistant message with interleaved text blocks and tool calls
 *
 * The `message:start` fact creates a skeleton entry (status: 'streaming').
 * React renders <stream-sink> as a placeholder shell.
 * StreamRouter writes tokens directly into the TextNode inside <stream-sink>.
 * When `message:finalized` arrives, React re-renders to update the status.
 *
 * Flow tokens NEVER touch React. StreamRouter → TextNode.appendData → DOM.
 */
function MessageItemComponent({ messageId, sessionRole }) {
  const message = useMessageState(messageId);
  if (!message || !message.messageId) return null;

  const isUser = message.role === 'user';
  const bg = isUser ? 'blue.subtle' : (ROLE_BG[sessionRole] || ROLE_BG.outer_review);
  const fg = isUser ? 'blue.fg' : (ROLE_FG[sessionRole] || ROLE_FG.outer_review);

  return (
    <Box
      bg={bg}
      color={fg}
      borderRadius={isUser ? 'lg' : 'l2'}
      p={isUser ? 3 : 4}
      maxW={isUser ? '80%' : undefined}
      overflowWrap="anywhere"
      alignSelf={isUser ? 'flex-end' : undefined}
      data-user-msg={isUser ? '' : undefined}
    >
      {isUser ? (
        message.staticContent || ''
      ) : (
        <InterleavedBlocks message={message} sessionRole={sessionRole} />
      )}
    </Box>
  );
}

function InterleavedBlocks({ message, sessionRole }) {
  const blocks = message.blocks;
  const toolIds = message.toolIds;

  return (
    <>
      {blocks?.map((block) => {
        if (block.type === 'text') {
          return (
            <Box key={block.id} display="inline">
              <stream-sink urn={block.id} />
            </Box>
          );
        }
        return null;
      })}
      {toolIds?.map((toolId) => (
        <ToolCall key={toolId} toolId={toolId} />
      ))}
    </>
  );
}

export default React.memo(MessageItemComponent);
