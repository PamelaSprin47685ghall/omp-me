import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Collapse, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

/**
 * @typedef {Object} ThinkingBlockProps
 * @property {string} content - Current thinking content
 * @property {boolean} [isStreaming] - Whether content is still streaming
 * @property {string} [messageId] - Message ID for tracking expand state
 */

const CONTAINER_STYLE = {
  marginBottom: '8px',
  border: '1px solid rgba(17, 20, 24, 0.15)',
  borderRadius: '3px',
  backgroundColor: 'rgba(138, 155, 168, 0.08)'
};

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  gap: '8px'
};

const CONTENT_STYLE = {
  padding: '12px', fontFamily: 'monospace', fontSize: '12px',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  color: '#5f6b7c', lineHeight: '1.6', margin: 0
};

const LABEL_STYLE = { fontWeight: 600, fontSize: '13px', color: '#5f6b7c' };

function useRafState(content) {
  const [display, setDisplay] = useState(content);
  const pendingRef = useRef(content);
  const rafRef = useRef(null);

  useEffect(() => {
    pendingRef.current = content;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        setDisplay(pendingRef.current);
        rafRef.current = null;
      });
    }
  }, [content]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return display;
}

/**
 * Collapsible thinking block with streaming support.
 * @param {ThinkingBlockProps} props
 */
export default function ThinkingBlock({ content, isStreaming = false, messageId }) {
  const [isOpen, setIsOpen] = useState(() => {
    const pref = localStorage.getItem('thinking_user_preference');
    return pref === 'expanded';
  });
  const displayContent = useRafState(content);

  const toggleOpen = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev;
      localStorage.setItem('thinking_user_preference', next ? 'expanded' : 'collapsed');
      return next;
    });
  }, []);

  return (
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE} onClick={toggleOpen} role="button" tabIndex={0}>
        <Icon
          icon={isOpen ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT}
          size={14}
        />
        <span style={LABEL_STYLE}>Thinking</span>
        {isStreaming && <Icon icon={IconNames.DOT} size={8} color="#2b95d6" />}
      </div>
      <Collapse isOpen={isOpen}>
        <pre style={CONTENT_STYLE}>{displayContent}</pre>
      </Collapse>
    </div>
  );
}
