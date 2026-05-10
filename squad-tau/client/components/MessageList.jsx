import React, { useRef } from 'react';
import MessageItem from './MessageItem.jsx';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

const CONTAINER_STYLE = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px'
};

const EMPTY_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#5C7080',
  fontStyle: 'italic'
};

export default function MessageList({ messages, sessionRole, deltas = [], toolCalls = [], toolResults = [] }) {
  const containerRef = useRef(null);
  
  useAutoScroll(containerRef, [messages, deltas]);

  if (!messages || messages.length === 0) {
    return (
      <div style={CONTAINER_STYLE} ref={containerRef}>
        <div style={EMPTY_STYLE}>No messages yet</div>
      </div>
    );
  }

  return (
    <div style={CONTAINER_STYLE} ref={containerRef}>
      {messages.map((msg) => (
        <MessageItem
          key={msg.messageId}
          message={msg}
          deltas={deltas}
          toolCalls={toolCalls.filter(tc => tc.messageId === msg.messageId)}
          toolResults={toolResults}
          sessionRole={sessionRole}
        />
      ))}
    </div>
  );
}
