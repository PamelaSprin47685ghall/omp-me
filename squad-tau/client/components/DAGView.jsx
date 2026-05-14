import React, { useMemo, useCallback, useRef } from 'react';
import { Center, VStack, Text, Icon } from '@chakra-ui/react';
import { GitBranch, AlertTriangle } from 'lucide-react';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';

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

const MERMAID_THEME = THEMES['github-light'];

export default function DAGView({ nodes, activeNodeId, onNodeClick }) {
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;
  const nodeList = nodes || [];

  const svg = useMemo(() => {
    if (!nodeList?.length) return null;
    const lines = ['graph TD'];
    const nodeMap = new Map(nodeList.map((node) => [node.id, node]));
    nodeList.forEach((node) => {
      const shape = node.id === activeNodeId ? `(${node.id})` : `[${node.id}]`;
      const statusColor = STATUS_COLOR[node.status] || STATUS_COLOR.pending;
      lines.push(`    ${node.id}${shape}`);
      lines.push(`    style ${node.id} fill:${statusColor}22,stroke:${statusColor},stroke-width:${node.id === activeNodeId ? 3 : 2}px`);
    });
    lines.push('    linkStyle default stroke:var(--app-mermaid-line),stroke-width:2px');
    nodeList.forEach((node) => {
      (node.depends_on || []).forEach((dep) => {
        if (nodeMap.has(dep)) lines.push(`    ${dep} --> ${node.id}`);
      });
    });
    try {
      return renderMermaidSVG(lines.join('\n'), MERMAID_THEME);
    } catch {
      return null;
    }
  }, [nodeList, activeNodeId]);

  const handleClick = useCallback((event) => {
    const node = event.target.closest('[data-id]');
    if (node) onClickRef.current?.(node.dataset.id);
  }, []);

  if (!nodeList.length) {
    return (
      <Center minH="300px">
        <VStack>
          <Icon as={GitBranch} boxSize={8} color="fg.subtle" />
          <Text color="fg.subtle">No nodes in DAG</Text>
        </VStack>
      </Center>
    );
  }

  if (!svg) {
    return (
      <Center minH="300px">
        <VStack>
          <Icon as={AlertTriangle} boxSize={8} color="fg.warning" />
          <Text color="fg.error">Failed to render DAG</Text>
        </VStack>
      </Center>
    );
  }

  const svgMarkup = svg.trim().startsWith('<svg')
    ? svg.trim().replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="auto"').replace('<svg ', '<svg class="dag-svg" ')
    : '<p>DAG render failed</p>';

  return (
    <Center
      w="full"
      p={4}
      minH="300px"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
