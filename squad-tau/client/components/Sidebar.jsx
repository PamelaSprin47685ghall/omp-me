import React, { useMemo, useCallback, useState } from 'react';
import { VStack, HStack, Text, Icon, Box, Collapsible } from '@chakra-ui/react';
import { CheckCircle, XCircle, Clock, RefreshCw, Ban, Circle, Network } from 'lucide-react';

const STATUS_ICONS = { approved: CheckCircle, rejected: XCircle, pending: Clock, active: RefreshCw, authoring: RefreshCw, confirming: RefreshCw, reviewing: RefreshCw, failed: Ban, blocked: Ban };
const STATUS_COLOR_MAP = { approved: 'green.fg', rejected: 'red.fg', failed: 'red.fg', blocked: 'red.fg', active: 'orange.fg', authoring: 'orange.fg', confirming: 'orange.fg', reviewing: 'orange.fg' };

function TreeIcon({ status, ...rest }) {
  const IconCmp = STATUS_ICONS[status] ?? Circle;
  return <Icon as={IconCmp} boxSize={4} color={STATUS_COLOR_MAP[status] ?? 'fg.subtle'} {...rest} />;
}

function SessionRow({ isSelected, sessionData, onClick }) {
  const { sessionId, status } = sessionData;
  const round = (sessionData.retryCount != null ? sessionData.retryCount : 0) + 1;
  const phase = sessionData.phase || 'worker';
  const label = `R${round} ${phase.replace(/_/g, ' ')}`;
  return (
    <HStack
      gap={1}
      px={1}
      py="0.5"
      cursor="pointer"
      borderRadius="md"
      bg={isSelected ? 'blue.subtle' : undefined}
      color={isSelected ? 'blue.fg' : 'inherit'}
      fontWeight={isSelected ? 600 : 400}
      onClick={onClick}
      role="treeitem"
      title={sessionId}
    >
      <TreeIcon status={status} />
      <Text fontSize="sm" truncate data-session-label>{label}</Text>
    </HStack>
  );
}

function NodeGroup({ node, children }) {
  const [expanded, setExpanded] = useState(true);
  const label = node?.label || node?.id || '';
  return (
    <Box>
      <HStack
        px={1}
        py="0.5"
        cursor="pointer"
        borderRadius="md"
        onClick={() => setExpanded(!expanded)}
        gap={1}
      >
        <TreeIcon status={node?.status} />
        <Text fontSize="sm" truncate data-node-label>{label}</Text>
      </HStack>
      <Collapsible.Root open={expanded}>
        <Collapsible.Content>
          <Box pl={3} borderLeft="1px solid" borderColor="border">
            {children}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}

function buildTreeData(sessions, nodes, activeSessionId) {
  const groupMap = new Map();
  const topLevel = [];
  sessions.forEach(session => {
    const { sessionId, nodeId, status } = session;
    if (!nodeId) { topLevel.push({ type: 'session', id: sessionId, sessionData: session, isSelected: activeSessionId === sessionId }); return; }
    if (!groupMap.has(nodeId)) { const info = nodes.get(nodeId); groupMap.set(nodeId, { type: 'group', id: nodeId, label: nodeId, status: info?.status, children: [] }); }
    groupMap.get(nodeId).children.push({ type: 'session', id: sessionId, sessionData: session, isSelected: activeSessionId === sessionId });
  });
  const result = []; groupMap.forEach(g => result.push(g)); topLevel.forEach(t => result.push(t));
  return result;
}

export default function Sidebar({ sessions, nodes, activeSessionId, onSelectSession, viewMode, onSelectDAG }) {
  const treeData = useMemo(() => buildTreeData(sessions, nodes, activeSessionId), [sessions, nodes, activeSessionId]);
  const handleNodeClick = useCallback((node) => { if (node.type === 'session') onSelectSession(node.id); }, [onSelectSession]);

  return (
    <VStack gap={1} p={4} flex="0 0 320px" minH={0} borderRight="1px solid" borderColor="border" overflowY="auto">
      <HStack
        px={1}
        py="0.5"
        cursor="pointer"
        borderRadius="md"
        bg={viewMode === 'dag' ? 'blue.subtle' : undefined}
        color={viewMode === 'dag' ? 'blue.fg' : 'inherit'}
        fontWeight={viewMode === 'dag' ? 600 : 400}
        onClick={onSelectDAG}
        role="treeitem"
        gap={1}
      >
        <Icon as={Network} boxSize={3} color="fg.subtle" />
        <Text fontSize="sm">DAG Overview</Text>
      </HStack>
      {treeData.map(node => {
        if (node.type === 'group') {
          return (
            <NodeGroup key={node.id} node={node}>
              {node.children.map(child => (
                <SessionRow key={child.id} sessionData={child.sessionData} isSelected={child.isSelected} onClick={() => handleNodeClick(child)} />
              ))}
            </NodeGroup>
          );
        }
        return <SessionRow key={node.id} sessionData={node.sessionData} isSelected={node.isSelected} onClick={() => handleNodeClick(node)} />;
      })}
    </VStack>
  );
}
