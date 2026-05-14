import React, { useMemo, useCallback, useState } from 'react';
import { VStack, Flex, Text, Icon, Box } from '@chakra-ui/react';
import Collapse from './Collapse.jsx';
import { CheckCircle, XCircle, Clock, RefreshCw, Ban, Circle, Network } from 'lucide-react';

const STATUS_ICONS = { approved: CheckCircle, rejected: XCircle, pending: Clock, active: RefreshCw, authoring: RefreshCw, confirming: RefreshCw, reviewing: RefreshCw, failed: Ban, blocked: Ban };
const STATUS_COLOR_MAP = { approved: 'green.600', rejected: 'red.600', failed: 'red.600', blocked: 'red.600', active: 'orange.600', authoring: 'orange.600', confirming: 'orange.600', reviewing: 'orange.600' };

function TreeIcon({ status, ...rest }) {
  const IconCmp = STATUS_ICONS[status] ?? Circle;
  return <Icon as={IconCmp} boxSize={4} color={STATUS_COLOR_MAP[status] ?? 'gray.400'} {...rest} />;
}

/** Shared styling for selectable rows */
const rowBg = (sel) => ({ bg: sel ? 'blue.50' : 'transparent', _dark: { bg: sel ? 'blue.900' : 'transparent' }, color: sel ? 'blue.700' : 'inherit', _dark: { color: sel ? 'blue.200' : 'inherit' }, fontWeight: sel ? 600 : 400 });

function SessionRow({ isSelected, sessionData, onClick }) {
  const { sessionId, status } = sessionData;
  const label = formatSessionLabel(sessionData);
  return (
    <Flex alignItems="center" p="2px 4px" cursor="pointer" borderRadius="md" {...rowBg(isSelected)} onClick={onClick} role="treeitem" title={sessionId}>
      <TreeIcon status={status} mr={1} />
      <Text fontSize="sm" isTruncated data-session-label>{label}</Text>
    </Flex>
  );
}

function NodeGroup({ node, children }) {
  const [expanded, setExpanded] = useState(true);
  const label = node?.label || node?.id || '';
  return (
    <Box>
      <Flex alignItems="center" p="2px 4px" cursor="pointer" borderRadius="md" onClick={() => setExpanded(!expanded)}>
        <TreeIcon status={node?.status} mr={1} />
        <Text fontSize="sm" isTruncated data-node-label>{label}</Text>
      </Flex>
      <Collapse in={expanded} animateOpacity>
        <Box pl={3} borderLeft="1px solid" borderColor="gray.200" _dark={{ borderColor: 'gray.600' }}>
          {children}
        </Box>
      </Collapse>
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

function DagRow({ isSelected, onClick }) {
  return (
    <Flex alignItems="center" p="2px 4px" cursor="pointer" borderRadius="md" {...rowBg(isSelected)} onClick={onClick} role="treeitem">
      <Icon as={Network} boxSize={3} color="gray.500" mr={1} />
      <Text fontSize="sm">DAG Overview</Text>
    </Flex>
  );
}

function formatSessionLabel(session) {
  if (!session) return '';
  const round = (session.retryCount != null ? session.retryCount : 0) + 1;
  const phase = session.phase || 'worker';
  return `R${round} ${phase.replace(/_/g, ' ')}`;
}

export default function Sidebar({ sessions, nodes, activeSessionId, onSelectSession, viewMode, onSelectDAG }) {
  const treeData = useMemo(() => buildTreeData(sessions, nodes, activeSessionId), [sessions, nodes, activeSessionId]);
  const handleNodeClick = useCallback((node) => { if (node.type === 'session') onSelectSession(node.id); }, [onSelectSession]);

  return (
    <VStack spacing={1} align="stretch" p={4}>
      <DagRow isSelected={viewMode === 'dag'} onClick={onSelectDAG} />
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
