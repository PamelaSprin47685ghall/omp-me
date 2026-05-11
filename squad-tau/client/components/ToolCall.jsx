import React, { useState, useCallback } from 'react';
import { Card, Collapse, Spinner, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

/** @typedef {import('../types').SessionToolCall} SessionToolCall */
/** @typedef {import('../types').SessionToolResult} SessionToolResult */

/**
 * @typedef {Object} ToolCallProps
 * @property {SessionToolCall} toolCall
 * @property {SessionToolResult} [toolResult]
 * @property {boolean} [isLatest]
 * @property {string} [borderColor]
 */

const JSON_STYLE = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'monospace',
  fontSize: '12px',
  margin: 0,
};

const CARD_STYLE = (borderColor) => ({
  marginBottom: '8px',
  borderLeft: `3px solid ${borderColor || '#2B95D6'}`,
});

const ERROR_STYLE = {
  color: '#CD4246',
  backgroundColor: 'rgba(205, 66, 70, 0.08)',
  padding: '8px',
  borderRadius: '3px',
};

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  cursor: 'pointer',
  userSelect: 'none',
};

const SECTION_HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
  padding: '4px 0',
  userSelect: 'none',
};

const SECTION_BODY_STYLE = {
  paddingLeft: '24px',
  paddingBottom: '8px',
};

/**
 * Format value as pretty-printed JSON string.
 * @param {*} value
 * @returns {string}
 */
function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolHeader({ expanded, onToggle, toolName, hasResult, isError }) {
  const expandIcon = expanded ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT;
  return (
    <div style={HEADER_STYLE} onClick={onToggle} role="button" tabIndex={0}>
      <Icon icon={expandIcon} size={14} />
      <Icon icon={IconNames.CODE_BLOCK} size={14} />
      <span style={{ fontWeight: 600 }}>{toolName}</span>
      {!hasResult && <Spinner size={14} />}
      {isError && <Icon icon={IconNames.ERROR} intent="danger" size={14} />}
    </div>
  );
}

function ToolResultSection({ hasResult, isError, open, onToggle, result }) {
  if (!hasResult) return null;
  return (
    <>
      <div style={SECTION_HEADER_STYLE} onClick={onToggle} role="button" tabIndex={0}>
        <Icon icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={12} />
        <Icon icon={isError ? IconNames.ERROR : IconNames.TICK} size={12} />
        <span style={{ fontSize: '12px', fontWeight: 600 }}>Result</span>
      </div>
      <Collapse isOpen={open}>
        <pre style={isError ? { ...JSON_STYLE, ...ERROR_STYLE } : JSON_STYLE}>
          {formatJson(result)}
        </pre>
      </Collapse>
    </>
  );
}

function ToolParamsSection({ open, onToggle, params }) {
  return (
    <>
      <div style={SECTION_HEADER_STYLE} onClick={onToggle} role="button" tabIndex={0}>
        <Icon icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={12} />
        <Icon icon={IconNames.PROPERTIES} size={12} />
        <span style={{ fontSize: '12px', fontWeight: 600 }}>Parameters</span>
      </div>
      <Collapse isOpen={open}>
        <pre style={JSON_STYLE}>{formatJson(params)}</pre>
      </Collapse>
    </>
  );
}

/**
 * Tool call card renderer.
 * @param {ToolCallProps} props
 */
export default function ToolCall({ toolCall, toolResult, isLatest, borderColor }) {
  const hasResult = toolResult !== undefined;
  const isError = toolResult?.isError ?? false;

  const [expanded, setExpanded] = useState(isLatest ?? false);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(isError || (isLatest && hasResult));

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);
  const toggleParams = useCallback(() => setParamsOpen((v) => !v), []);
  const toggleResult = useCallback(() => setResultOpen((v) => !v), []);

  return (
    <Card style={CARD_STYLE(borderColor)} compact>
      <ToolHeader
        expanded={expanded}
        onToggle={toggleExpanded}
        toolName={toolCall.toolName}
        hasResult={hasResult}
        isError={isError}
      />
      <Collapse isOpen={expanded}>
        <div style={SECTION_BODY_STYLE}>
          <ToolParamsSection
            open={paramsOpen}
            onToggle={toggleParams}
            params={toolCall.params}
          />
          <ToolResultSection
            hasResult={hasResult}
            isError={isError}
            open={resultOpen}
            onToggle={toggleResult}
            result={toolResult?.result}
          />
        </div>
      </Collapse>
    </Card>
  );
}
