import React, { useRef, useEffect, useMemo } from 'react';
import { Box, Text } from '@chakra-ui/react';
import ToolCall from './ToolCall.jsx';
import { useMessageState } from '../hooks/useAtomicState.js';

const ROLE_BG = { user: 'blue.subtle', authoring: 'green.subtle', confirming: 'green.subtle', reviewing: 'orange.subtle', outer_review: 'bg.subtle' };
const ROLE_FG = { user: 'blue.fg', authoring: 'green.fg', confirming: 'green.fg', reviewing: 'orange.fg', outer_review: 'fg' };

/**
 * MessageItem — renders either:
 *   1. Static user message
 *   2. Assistant message with interleaved text blocks and tool calls
 *
 * During streaming (non-finalized): single <agent-message> + tool calls below.
 * After finalization: interleave text blocks and <ToolCall> components
 * according to message.contentBlocks order, preserving causal chain.
 */
function MessageItemComponent({ messageId, sessionRole }) {
  const meta = useMessageState(messageId);
  const agentRef = useRef(null);

  useEffect(() => {
    if (meta?.status === 'finalized' && meta.staticContent && agentRef.current) {
      agentRef.current.finalize(meta.staticContent);
    }
  }, [meta?.status, meta?.staticContent]);

  if (!meta || !meta.messageId) return null;

  const isUser = meta.role === 'user';
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
        meta.staticContent || ''
      ) : (
        <InterleavedBlocks
          meta={meta}
          agentRef={agentRef}
          sessionRole={sessionRole}
        />
      )}
    </Box>
  );
}

/**
 * Renders assistant message content with interleaved text and tool call blocks.
 *
 * For finalized messages with contentBlocks: iterates blocks in order,
 * rendering text blocks as <agent-message> segments and tool blocks as <ToolCall>.
 * This preserves the exact causal chain the LLM produced.
 *
 * For streaming (non-finalized) messages: renders a single <agent-message>
 * for all text (receives streaming deltas) with tool calls below.
 */
function InterleavedBlocks({ meta, agentRef, sessionRole }) {
  // Finalized with structured content blocks → interleave
  if (meta.status === 'finalized' && Array.isArray(meta.blocks) && meta.blocks.length > 0) {
    return (
      <>
        {meta.blocks.map((block, idx) => {
          if (block.type === 'text') {
            return (
              <Box key={block.id} mb={meta.blocks.length > 1 && idx < meta.blocks.length - 1 ? 2 : 0}>
                <agent-message
                  ref={idx === 0 ? agentRef : undefined}
                  message-id={block.id}
                  role={meta.role}
                />
              </Box>
            );
          }
          if (block.type === 'tool') {
            return (
              <Box key={block.id} my={1}>
                <ToolCall toolId={block.id} />
              </Box>
            );
          }
          return null;
        })}
      </>
    );
  }

  // Finalized but no content blocks — existing behavior
  if (meta.status === 'finalized') {
    return (
      <>
        <agent-message
          ref={agentRef}
          message-id={meta.messageId}
          role={meta.role}
        />
        {meta.toolIds?.length > 0 && (
          <Box mt={2}>
            {meta.toolIds.map((tid) => (
              <ToolCall key={tid} toolId={tid} />
            ))}
          </Box>
        )}
      </>
    );
  }

  // Streaming — single agent-message, tools below
  return (
    <>
      <agent-message
        ref={agentRef}
        message-id={meta.messageId}
        role={meta.role}
      />
      {meta.toolIds?.length > 0 && (
        <Box mt={2}>
          {meta.toolIds.map((tid) => (
            <ToolCall key={tid} toolId={tid} />
          ))}
        </Box>
      )}
    </>
  );
}

export default React.memo(MessageItemComponent);
