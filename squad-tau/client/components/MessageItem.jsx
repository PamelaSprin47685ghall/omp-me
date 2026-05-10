import React from 'react';
import { Card, Intent } from '@blueprintjs/core';
import ThinkingBlock from './ThinkingBlock.jsx';
import ToolCall from './ToolCall.jsx';
import {
  ROLE_COLORS, USER_CARD_STYLE, SYSTEM_CONTAINER_STYLE,
  SYSTEM_TEXT_STYLE, ASSISTANT_TEXT_STYLE
} from '../styles/messageStyles.js';
import { extractText } from '../utils/messageUtils.js';

/** @typedef {import('../types').SessionMessage} SessionMessage */
/** @typedef {import('../types').SessionMessageDelta} SessionMessageDelta */
/** @typedef {import('../types').SessionToolCall} SessionToolCall */
/** @typedef {import('../types').SessionToolResult} SessionToolResult */

/**
 * @typedef {Object} MessageItemProps
 * @property {SessionMessage} message
 * @property {SessionMessageDelta[]} [deltas]
 * @property {SessionToolCall[]} [toolCalls]
 * @property {SessionToolResult[]} [toolResults]
 * @property {'user'|'worker'|'reviewer'|'outer'} [sessionRole]
 */

const ASSISTANT_OUTER_STYLE = (borderColor) => ({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  marginBottom: '12px',
  borderLeft: `4px solid ${borderColor}`
});

/**
 * @param {{ deltas: SessionMessageDelta[], toolCalls: SessionToolCall[], toolResults: SessionToolResult[], message: SessionMessage, borderColor: string }} props
 */
function AssistantMessage({ deltas, toolCalls, toolResults, message, borderColor }) {
  const msgDeltas = deltas.filter(d => d.messageId === message.messageId);
  const thinkingContent = msgDeltas.filter(d => d.delta.type === 'thinking_delta').map(d => d.delta.text).join('');
  const deltaText = msgDeltas.filter(d => d.delta.type === 'text_delta').map(d => d.delta.text).join('');
  const textContent = extractText(message.content) + deltaText;
  const msgToolCalls = toolCalls.filter(tc => tc.messageId === message.messageId);
  return (
    <div style={ASSISTANT_OUTER_STYLE(borderColor)}>
      {thinkingContent && <ThinkingBlock content={thinkingContent} isStreaming={msgDeltas.length > 0} messageId={message.messageId} />}
      {msgToolCalls.map((tc, i) => (
        <ToolCall key={tc.toolId} toolCall={tc} toolResult={toolResults.find(r => r.toolId === tc.toolId)} isLatest={i === msgToolCalls.length - 1} borderColor={borderColor} />
      ))}
      {textContent && <Card style={ASSISTANT_TEXT_STYLE} intent={Intent.NONE}>{textContent}</Card>}
    </div>
  );
}

/**
 * Individual message renderer with role-based styling.
 * @param {MessageItemProps} props
 */
export default function MessageItem({ message, deltas = [], toolCalls = [], toolResults = [], sessionRole = 'user' }) {
  const borderColor = ROLE_COLORS[sessionRole];
  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <Card style={USER_CARD_STYLE(borderColor)} intent={Intent.PRIMARY}>{extractText(message.content)}</Card>
      </div>
    );
  }
  if (message.role === 'system') {
    return (
      <div style={SYSTEM_CONTAINER_STYLE(borderColor)}>
        <span style={SYSTEM_TEXT_STYLE}>{extractText(message.content)}</span>
      </div>
    );
  }
  return <AssistantMessage deltas={deltas} toolCalls={toolCalls} toolResults={toolResults} message={message} borderColor={borderColor} />;
}