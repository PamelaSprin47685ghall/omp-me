import React from 'react';
import { Card, Tag } from '@blueprintjs/core';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';

const ROLE_INTENT = { user: 'primary', worker: 'success', reviewer: 'warning', outer: 'none' };

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
  const thinking = message.content?.filter(b => b.type === 'thinking').map(b => b.text).join('') || '';
  const text = extractText(message.content);
  const toolCalls = message.content?.filter(b => b.type === 'tool_call') || [];
  const intent = ROLE_INTENT[sessionRole] || 'none';

  return (
    <div className="msg-assistant">
      {thinking && <ThinkingBlock content={thinking} isStreaming={message.streaming} />}
      {toolCalls.map(tc => (
        <ToolCall key={tc.toolId} toolCall={tc} sessionRole={sessionRole} />
      ))}
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
