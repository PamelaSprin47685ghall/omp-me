import React, { useRef } from 'react';
import { Button, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import MessageItem from './MessageItem.jsx';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

const CONTAINER_STYLE = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const VIRTUAL_ITEM_STYLE = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 60px',
};

const EMPTY_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#5C7080',
  fontStyle: 'italic',
};

const FLOAT_BTN_STYLE = {
  position: 'fixed',
  bottom: '80px',
  right: '24px',
  borderRadius: '50%',
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  zIndex: 100,
};

const ScrollButton = ({ visible, onClick }) => {
  if (!visible) return null;
  return (
    <div style={FLOAT_BTN_STYLE}>
      <Button
        icon={<Icon icon={IconNames.ARROW_DOWN} size={16} />}
        onClick={onClick}
        minimal
        large
        title="Scroll to latest message"
      />
    </div>
  );
};

export default function MessageList({ messages, sessionRole, deltas = [], toolCalls = [], toolResults = [] }) {
  const containerRef = useRef(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(containerRef, [messages, deltas]);

  if (!messages?.length) {
    return (
      <div style={CONTAINER_STYLE} ref={containerRef}>
        <div style={EMPTY_STYLE}>No messages yet</div>
      </div>
    );
  }

  return (
    <div style={CONTAINER_STYLE} ref={containerRef}>
      {messages.map((msg) => (
        <div key={msg.messageId} style={VIRTUAL_ITEM_STYLE}>
          <MessageItem
            message={msg}
            deltas={deltas}
            toolCalls={toolCalls.filter((tc) => tc.messageId === msg.messageId)}
            toolResults={toolResults}
            sessionRole={sessionRole}
          />
        </div>
      ))}
      <ScrollButton visible={!isAtBottom} onClick={scrollToBottom} />
    </div>
  );
}
