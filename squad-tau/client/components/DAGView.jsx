import React, { useMemo, useCallback, useRef } from 'react';
import { Center, VStack, Text, Icon } from '@chakra-ui/react';
import { GitBranch, AlertTriangle } from 'lucide-react';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
import { usePathState, useUiState } from '../hooks/useAtomicState.js';
import { uiStore } from '../ui-store.js';

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

export default function DAGView() {
  const nodeMap = usePathState('squad', s => s.nodes || {});
  const activeNodeId = useUiState(s => s.activeSessionId);

  // Stable dependency: only id, depends_on, and status affect the DAG topology.
  // summary, retryCount, feedback, affectedFiles are excluded to avoid
  // expensive mermaid re-renders on every node update.
  const dagKey = useMemo(() => {
    const nodes = Object.values(nodeMap);
    if (!nodes.length) return null;
    return nodes
      .map((n) => `${n.id}:${n.status}:${(n.depends_on || []).slice().sort().join(',')}`)
      .sort()
      .join('|');
  }, [nodeMap]);

  const svg = useMemo(() => {
    if (!dagKey) return null;
    const nodes = Object.values(nodeMap);
    const lines = ['graph TD'];
    const nm = new Map(nodes.map((node) => [node.id, node]));
    nodes.forEach((node) => {
      const shape = node.id === activeNodeId ? `(${node.id})` : `[${node.id}]`;
      const statusColor = STATUS_COLOR[node.status] || STATUS_COLOR.pending;
      lines.push(`    ${node.id}${shape}`);
      lines.push(`    style ${node.id} fill:${statusColor}22,stroke:${statusColor},stroke-width:${node.id === activeNodeId ? 3 : 2}px`);
    });
    lines.push('    linkStyle default stroke:var(--app-mermaid-line),stroke-width:2px');
    nodes.forEach((node) => {
      (node.depends_on || []).forEach((dep) => {
        if (nm.has(dep)) lines.push(`    ${dep} --> ${node.id}`);
      });
    });
    try {
      return renderMermaidSVG(lines.join('\n'), MERMAID_THEME);
    } catch {
      return null;
    }
    // dagKey is the stable topology fingerprint; activeNodeId triggers highlight changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dagKey, activeNodeId, nodeMap]);

  const handleClick = useCallback((event) => {
    const node = event.target.closest('[data-id]');
    if (node) {
      const state = eventStore.getState();
      const nodeId = node.dataset.id;
      const session = Object.values(state.sessions).find((s) => s.nodeId === nodeId);
      if (session) uiStore.dispatch('ui:select_session', { sessionId: session.sessionId });
    }
  }, []);

  if (!dagKey) {
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
