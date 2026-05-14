import React, { useState, useCallback } from 'react';
import { Collapse, Icon, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export default function ThinkingBlock({ content, isStreaming = false }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  return (
    <div>
      <div
        onClick={toggle}
        role="button"
        tabIndex={0}
        className="bp6-text-small thinking-header"
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 0' }}
      >
        <Icon icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={12} />
        <Icon icon={IconNames.LIGHTBULB} size={12} intent="primary" />
        <span>Thinking</span>
        {isStreaming && <Tag minimal round intent="primary">live</Tag>}
      </div>
      <Collapse isOpen={open}>
        <pre className="bp6-padded bp6-monospace-text" style={{ margin: 0 }}>{content}</pre>
      </Collapse>
    </div>
  );
}
