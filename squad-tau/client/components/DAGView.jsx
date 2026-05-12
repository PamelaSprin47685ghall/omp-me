import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, Collapse, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });

const PANEL_STYLE = { marginBottom: 12 };

const TOGGLE_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  userSelect: 'none',
  padding: '6px 0',
  fontSize: 13,
  fontWeight: 500,
};

const DAG_WRAPPER_STYLE = { padding: '8px 16px 16px', overflowX: 'auto' };

const DAG_CONTAINER_STYLE = {
  display: 'flex',
  justifyContent: 'center',
  minHeight: 120,
};

const STATUS_COLOR = {
  approved: '#2b9842',
  rejected: '#cc3440',
  authoring: '#c1b90d',
  pending: '#919191',
  failed: '#8b1919',
  waiting_deps: '#6f6f6f',
  confirming: '#c1b90d',
  reviewing: '#c1b90d',
  blocked: '#8b1919',
};

function buildDiagram(nodeList, activeNodeId) {
  if (!nodeList?.length) return 'graph LR\n    Empty["No nodes"]';
  const nodeMap = new Map(nodeList.map(n => [n.id, n]));
  const lines = ['graph TD'];
  nodeList.forEach(n => {
    const color = STATUS_COLOR[n.status] ?? STATUS_COLOR.pending;
    const shape = n.id === activeNodeId ? `(${n.id})` : `[${n.id}]`;
    lines.push(`    ${n.id}${shape}`);
    lines.push(`    style ${n.id} fill:${color},stroke:${color},color:#fff`);
  });
  nodeList.forEach(n => {
    if (n.depends_on?.length) {
      n.depends_on.forEach(depId => {
        if (nodeMap.has(depId)) lines.push(`    ${depId} --> ${n.id}`);
      });
    }
  });
  return lines.join('\n');
}

function nodeStateKey(nodes, activeNodeId) {
  if (!nodes) return '';
  return nodes.map(n => `${n.id}:${n.status}`).join('|') + `!!active:${activeNodeId}`;
}

function attachClickHandlers(container, onNodeClickRef) {
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;
  svg.style.maxWidth = '100%';
  svg.querySelectorAll('g.node').forEach(g => {
    g.style.cursor = 'pointer';
    const label = g.querySelector('text');
    if (label) label.style.fontFamily = 'inherit';
    const nodeId = label?.textContent?.replace(/[()\[\]]/g, '') ?? '';
    g.onclick = () => nodeId && onNodeClickRef.current?.(nodeId);
  });
}

function useMermaidRender(nodeList, activeNodeId, onNodeClick) {
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const containerRef = useRef(null);
  const renderedKeyRef = useRef(null);
  const stateKey = nodeStateKey(nodeList, activeNodeId);

  const renderDiagram = useCallback(async (list) => {
    const el = containerRef.current;
    if (!el) return;
    const diagram = buildDiagram(list, activeNodeId);
    const id = `d-${Date.now()}`;
    try {
      const { svg } = await mermaid.render(id, diagram);
      if (containerRef.current) containerRef.current.innerHTML = svg;
      attachClickHandlers(containerRef.current, onNodeClickRef);
    } catch (err) {
      console.error('[DAGView] mermaid render error:', err);
    }
  }, [activeNodeId]);

  useEffect(() => {
    renderedKeyRef.current = stateKey;
    renderDiagram(nodeList);
  }, [stateKey, nodeList, renderDiagram]);

  return containerRef;
}

/**
 * Renders a Mermaid DAG visualization for squad nodes.
 * @param {import('../types').DAGViewProps} props
 */
export default function DAGView({ nodes, activeNodeId, onNodeClick }) {
  const [expanded, setExpanded] = useState(true);
  const nodeList = useMemo(() => {
    if (!nodes) return [];
    if (Array.isArray(nodes)) return nodes;
    if (nodes instanceof Map) return Array.from(nodes.values());
    return [];
  }, [nodes]);

  const containerRef = useMermaidRender(nodeList, activeNodeId, onNodeClick);

  return (
    <Card style={PANEL_STYLE} elevation={2}>
      <div style={TOGGLE_STYLE} onClick={() => setExpanded(v => !v)} role="button" aria-expanded={expanded}>
        <Icon icon={expanded ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT} size={14} />
        <span>DAG View</span>
      </div>
      <Collapse isOpen={expanded}>
        <div style={DAG_WRAPPER_STYLE}>
          <div style={DAG_CONTAINER_STYLE}>
            <div ref={containerRef} />
          </div>
        </div>
      </Collapse>
    </Card>
  );
}
