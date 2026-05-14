import React, { useState, useCallback } from 'react';
import { Collapse, Icon, Tag, Pre } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

function argsPreview(toolName, params) {
  if (!params) return '';
  if (params.path) return params.path;
  if (typeof params.command === 'string') return params.command.slice(0, 80);
  if (typeof params.query === 'string') return params.query.slice(0, 60);
  if (params.url) return params.url;
  const first = Object.values(params).find((value) => typeof value === 'string' && value.length > 0);
  return first ? first.slice(0, 60) : '';
}

function formatResult(result) {
  if (!result) return '';
  if (Array.isArray(result)) return result.map((block) => (block.type === 'text' ? block.text : JSON.stringify(block))).join('\n');
  if (result.content && Array.isArray(result.content)) {
    return result.content.map((block) => (block.type === 'text' ? block.text : JSON.stringify(block))).join('\n');
  }
  return JSON.stringify(result, null, 2);
}

export default function ToolCall({ toolCall }) {
  const { toolName, params, result, isError } = toolCall;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const hasResult = result !== undefined;
  const preview = argsPreview(toolName, params);

  return (
    <div>
      <div
        className="bp6-text-small tool-header"
        onClick={toggle}
        role="button"
        tabIndex={0}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0', width: '100%' }}
      >
        <Icon icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={12} />
        <Icon icon={IconNames.CODE} size={12} />
        <span className="bp6-monospace-text">{toolName}</span>
        {preview && <span className="bp6-text-small bp6-text-muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span>}
        <span style={{ display: 'flex', gap: 4 }}>
          {isError && <Tag minimal intent="danger">error</Tag>}
          {hasResult && !isError && <Tag minimal intent="success">done</Tag>}
          {!hasResult && <Tag minimal>running</Tag>}
        </span>
      </div>
      <Collapse isOpen={open}>
        {params && Object.keys(params).length > 0 && (
          <Pre className="bp6-padded bp6-monospace-text" style={{ margin: 0 }}>{JSON.stringify(params, null, 2)}</Pre>
        )}
        {hasResult && (
          <Pre className={`bp6-padded ${isError ? 'bp6-text-danger' : ''}`} style={{ margin: 0 }}>
            {formatResult(result)}
          </Pre>
        )}
      </Collapse>
    </div>
  );
}
