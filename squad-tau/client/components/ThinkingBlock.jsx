import React, { useState, useCallback } from 'react';
import { Card, Collapse, Icon, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export default function ThinkingBlock({ content, isStreaming = false }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);

  return (
    <Card elevation={0} className="thinking-card">
      <div
        onClick={toggle}
        role="button"
        tabIndex={0}
        className="thinking-header"
      >
        <Icon icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={12} />
        <Icon icon={IconNames.LIGHTBULB} size={12} intent="primary" />
        <span className="thinking-title">Thinking</span>
        {isStreaming && <Tag minimal round intent="primary" className="thinking-live">live</Tag>}
      </div>
      <Collapse isOpen={open}>
        <pre className="thinking-content">{content}</pre>
      </Collapse>
    </Card>
  );
}
