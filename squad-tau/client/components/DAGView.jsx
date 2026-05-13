import React, { useMemo, useCallback, useRef } from 'react';
import { NonIdealState } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { renderMermaidSVG } from 'beautiful-mermaid';

const STATUS_COLOR = {
  approved: '#2b9842', rejected: '#cc3440', authoring: '#c1b90d',
  pending: '#919191', failed: '#8b1919', waiting_deps: '#6f6f6f',
  confirming: '#c1b90d', reviewing: '#c1b90d', blocked: '#8b1919',
};

function buildDiagram(nodeList, activeNodeId) {
  if (!nodeList?.length) return null;
  const lines = ['graph TD'];
  const nodeMap = new Map(nodeList.map(n => [n.id, n]));
  nodeList.forEach(n => {
    const shape = n.id === activeNodeId ? `(${n.id})` : `[${n.id}]`;
    const statusColor = STATUS_COLOR[n.status] || STATUS_COLOR.pending;
    lines.push(`    ${n.id}${shape}`);
    lines.push(`    style ${n.id} fill:${statusColor}22,stroke:${statusColor},stroke-width:${n.id === activeNodeId ? 3 : 2}px`);
  });
  lines.push('    linkStyle default stroke:var(--app-mermaid-line),stroke-width:2px');
  nodeList.forEach(n => {
    (n.depends_on || []).forEach(dep => {
      if (nodeMap.has(dep)) lines.push(`    ${dep} --> ${n.id}`);
    });
  });
  return lines.join('\n');
}

function toNodeList(nodes) {
  if (Array.isArray(nodes)) return nodes;
  if (nodes instanceof Map) return Array.from(nodes.values());
  return [];
}

export default function DAGView({ nodes, activeNodeId, onNodeClick }) {
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;
  const nodeList = useMemo(() => toNodeList(nodes), [nodes]);

  const svg = useMemo(() => {
    const diagram = buildDiagram(nodeList, activeNodeId);
    if (!diagram) return null;
    try {
      return renderMermaidSVG(diagram, {
        bg: 'var(--app-mermaid-bg)',
        fg: 'var(--app-mermaid-fg)',
        accent: 'var(--app-mermaid-accent)',
        muted: 'var(--app-mermaid-muted)',
        line: 'var(--app-mermaid-line)',
        border: 'var(--app-mermaid-border)',
        surface: 'var(--app-mermaid-surface)',
        transparent: true,
      });
    } catch { return null; }
  }, [nodeList, activeNodeId]);

  const handleClick = useCallback((e) => {
    const node = e.target.closest('[data-id]');
    if (node) onClickRef.current?.(node.dataset.id);
  }, []);

  if (!nodeList.length) {
    return <NonIdealState icon={IconNames.GRAPH} description="No nodes in DAG" />;
  }

  if (!svg) {
    return <NonIdealState icon={IconNames.WARNING_SIGN} description="Failed to render DAG" />;
  }

  return (
    <div
      className="dag-container"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
