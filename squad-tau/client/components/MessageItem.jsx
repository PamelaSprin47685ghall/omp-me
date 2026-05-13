import React from 'react';
import { Card, Tag } from '@blueprintjs/core';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';

const ROLE_INTENT = { user: 'primary', worker: 'success', reviewer: 'warning', outer: 'none' };
const ROLE_ACCENT = { worker: '#238551', reviewer: '#D9822B', outer: '#7157D9' };

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function UserMessage({ message }) {
  return (
    <div className="msg-user">
      <Card interactive={false} elevation={0} className="msg-user-card">
        {extractText(message.content)}
      </Card>
    </div>
  );
}

function AssistantMessage({ message, sessionRole }) {
  const content = message.content || [];
  const toolCalls = content.filter(b => b.type === 'tool_call');
  const nonToolBlocks = content.filter(b => b.type !== 'tool_call');
  const thinking = nonToolBlocks.filter(b => b.type === 'thinking').map(b => b.text).join('') || '';
  const text = extractText(nonToolBlocks);
  const intent = ROLE_INTENT[sessionRole] || 'none';
  const accent = ROLE_ACCENT[sessionRole] || 'transparent';

  // Pure tool-call messages (created by handleSessionToolCall/handleSessionToolResult)
  // are rendered here. Full assistant messages (from message_end) may also embed
  // tool_call blocks, but those lack results — skip them to avoid duplication.
  if (!text && !thinking && toolCalls.length > 0) {
    return (
      <div className="msg-assistant" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>
        {toolCalls.map(tc => (
          <ToolCall key={tc.toolId} toolCall={tc} sessionRole={sessionRole} />
        ))}
      </div>
    );
  }

  return (
    <div className="msg-assistant" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>
      {thinking && <ThinkingBlock content={thinking} isStreaming={message.streaming} />}
      {text && (
        <div className="assistant-text-block">
          {message.streaming && <Tag minimal round intent={intent} className="streaming-tag">streaming</Tag>}
          {text}
        </div>
      )}
    </div>
  );
}

export default function MessageItem({ message, sessionRole = 'user' }) {
  if (message.role === 'user') return <UserMessage message={message} />;
  return <AssistantMessage message={message} sessionRole={sessionRole} />;
}
