import React from 'react';
import { Card, Callout, Tag } from '@blueprintjs/core';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';

const ROLE_INTENT = { user: 'primary', worker: 'success', reviewer: 'warning', outer: 'none' };

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

function UserMessage({ message }) {
  return (
    <div className="bp6-align-right" style={{ overflow: 'hidden' }}>
      <Card interactive={false} elevation={0} className="bp6-padded bp6-margin-bottom" style={{ maxWidth: '80%', marginLeft: 'auto', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{extractText(message.content)}</Card>
    </div>
  );
}

function AssistantMessage({ message, sessionRole }) {
  const content = message.content || [];
  const toolCalls = content.filter((block) => block.type === 'tool_call');
  const nonToolBlocks = content.filter((block) => block.type !== 'tool_call');
  const thinking = nonToolBlocks.filter((block) => block.type === 'thinking').map((block) => block.text).join('') || '';
  const text = extractText(nonToolBlocks);
  const intent = ROLE_INTENT[sessionRole] || 'none';

  return (
    <Callout intent={intent} className="bp6-padded bp6-margin-bottom" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
      {thinking && <ThinkingBlock content={thinking} isStreaming={message.streaming} />}
      {text && (
        <div>
          {message.streaming && <Tag minimal round intent={intent}>streaming</Tag>}
          {text}
        </div>
      )}
      {toolCalls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {toolCalls.map((toolCall) => (
            <ToolCall key={toolCall.toolId} toolCall={toolCall} sessionRole={sessionRole} />
          ))}
        </div>
      )}
    </Callout>
  );
}

export default function MessageItem({ message, sessionRole = 'user' }) {
  if (message.role === 'user') return <UserMessage message={message} />;
  return <AssistantMessage message={message} sessionRole={sessionRole} />;
}
