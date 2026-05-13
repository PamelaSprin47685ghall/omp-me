import React, { useState, useCallback } from 'react';
import { Card, Collapse, Icon, Tag, Pre } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

function argsPreview(toolName, params) {
  if (!params) return '';
  if (params.path) return params.path;
  if (params.command) return params.command.slice(0, 80);
  if (params.query) return params.query.slice(0, 60);
  if (params.url) return params.url;
  const first = Object.values(params).find(v => typeof v === 'string' && v.length > 0);
  return first ? first.slice(0, 60) : '';
}

function formatResult(result) {
  if (!result) return '';
  if (Array.isArray(result)) return result.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n');
  if (result.content && Array.isArray(result.content)) {
    return result.content.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n');
  }
  return JSON.stringify(result, null, 2);
}

export default function ToolCall({ toolCall }) {
  const { toolName, params, result, isError } = toolCall;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const hasResult = result !== undefined;
  const preview = argsPreview(toolName, params);

  return (
    <Card elevation={0} className="msg-tool tool-card">
      <button type="button" className="tool-header" onClick={toggle}>
        <Icon icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={12} />
        <Icon icon={IconNames.CODE} size={12} />
        <span className="tool-name">{toolName}</span>
        {preview && <span className="tool-preview">{preview}</span>}
        <span className="tool-state">
          {isError && <Tag minimal intent="danger">error</Tag>}
          {hasResult && !isError && <Tag minimal intent="success">done</Tag>}
          {!hasResult && <Tag minimal>running</Tag>}
        </span>
      </button>
      <Collapse isOpen={open}>
        {params && Object.keys(params).length > 0 && (
          <Pre className="tool-pre">{JSON.stringify(params, null, 2)}</Pre>
        )}
        {hasResult && (
          <Pre className={isError ? 'tool-pre tool-pre-error' : 'tool-pre'}>
            {formatResult(result)}
          </Pre>
        )}
      </Collapse>
    </Card>
  );
}
