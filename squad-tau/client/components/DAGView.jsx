import React, { useMemo, useCallback, useRef } from 'react';
import { NonIdealState } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { renderMermaidSVG } from 'beautiful-mermaid';

const STATUS_COLOR = Object.freeze({
    waiting_deps: '#6c7a89',
    pending: '#8a9ba8',
    authoring: '#3085c3',
    confirming: '#9364c8',
    reviewing: '#e08a1e',
    approved: '#5bb66e',
    rejected: '#c23030',
    blocked: '#b8652a',
    failed: '#db3737',
});

const MERMAID_THEME = {
  bg: '#383e47',
  fg: '#f6f7f9',
  accent: '#2d72d2',
  muted: '#abb2b9',
  line: '#abb2b9',
  border: '#f6f7f9',
  surface: '#535a63',
  transparent: true,
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
      return renderMermaidSVG(diagram, MERMAID_THEME);
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
      dangerouslySetInnerHTML={{ __html: svg.trim().startsWith('<svg') ? svg : '<p>DAG render failed</p>' }}
    />
  );
}
