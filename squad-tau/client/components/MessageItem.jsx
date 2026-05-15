import React, { useRef, useEffect } from 'react';
import { Box } from '@chakra-ui/react';
import ToolCall from './ToolCall.jsx';
import { useMessageState } from '../hooks/useAtomicState.js';

const ROLE_BG = { user: 'blue.subtle', authoring: 'green.subtle', confirming: 'green.subtle', reviewing: 'orange.subtle', outer_review: 'bg.subtle' };
const ROLE_FG = { user: 'blue.fg', authoring: 'green.fg', confirming: 'green.fg', reviewing: 'orange.fg', outer_review: 'fg' };

/**
 * MessageItem — pure topology shell.
 *
 * Renders either:
 *   1. Static user message (from state.messages[id].staticContent)
 *   2. Immortal <agent-message> custom element (for streaming or finalized assistant messages)
 *
 * ZERO content in state tree. ZERO streaming awareness in React.
 * The <agent-message> element manages its own lifecycle.
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
        // Static user message — rendered directly from state
        meta.staticContent || ''
      ) : (
        // Immortal native box — handles streaming + finalized internally
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
      )}
    </Box>
  );
}

export default React.memo(MessageItemComponent);
