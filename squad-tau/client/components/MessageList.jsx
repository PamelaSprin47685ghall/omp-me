import React, { useRef } from 'react';
import { Button, Icon, NonIdealState } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import MessageItem from './MessageItem.jsx';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

export default function MessageList({ messages, sessionRole }) {
  const containerRef = useRef(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(containerRef, messages);

  if (!messages?.length) {
    return (
      <div className="msg-scroll" ref={containerRef}>
        <NonIdealState icon={IconNames.CHAT} description="No messages yet" />
      </div>
    );
  }

  return (
    <div className="msg-scroll" ref={containerRef}>
      {messages.map(msg => (
        <MessageItem key={msg.messageId} message={msg} sessionRole={sessionRole} />
      ))}
      {!isAtBottom && (
        <div className="scroll-down-wrap">
          <Button
            icon={<Icon icon={IconNames.ARROW_DOWN} />}
            minimal round small
            onClick={scrollToBottom}
          />
        </div>
      )}
    </div>
  );
}
