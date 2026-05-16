import React, { useMemo, useState, useCallback } from 'react';
import { VStack, HStack, Text, Icon, Box, Collapsible } from '@chakra-ui/react';
import { CheckCircle, XCircle, Clock, RefreshCw, Ban, Circle, Network } from 'lucide-react';
import { usePathState, useUiState, useSessions } from '../hooks/useAtomicState.js';
import { uiStore } from '../ui-store.js';

const STATUS_ICONS = { approved: CheckCircle, rejected: XCircle, pending: Clock, active: RefreshCw, authoring: RefreshCw, confirming: RefreshCw, reviewing: RefreshCw, failed: Ban, blocked: Ban };
const STATUS_COLOR_MAP = { 
  approved: 'green.fg', 
  rejected: 'red.fg', 
  failed: 'red.fg', 
  blocked: 'fg.muted', 
  active: 'orange.fg', 
  authoring: 'orange.fg', 
  confirming: 'orange.fg', 
  reviewing: 'orange.fg',
  pending: 'fg.subtle'
};
const ACTIVE_STATUSES = ['authoring', 'active', 'confirming', 'reviewing'];

function TreeIcon({ status, ...rest }) {
  const IconCmp = STATUS_ICONS[status] ?? Circle;
  const isAnimating = ACTIVE_STATUSES.includes(status);
  
  return (
    <Icon 
      as={IconCmp} 
      boxSize={4} 
      color={STATUS_COLOR_MAP[status] || 'fg.subtle'}
      css={isAnimating ? {
        animation: 'squad-pulse 2s infinite ease-in-out',
        '@keyframes squad-pulse': {
          '0%': { opacity: 1 },
          '50%': { opacity: 0.6 },
          '100%': { opacity: 1 }
        }
      } : undefined}
      {...rest} 
    />
  );
}

function SessionRow({ sessionData }) {
  const { sessionId, status, epoch = 0, phase, nodeId } = sessionData;
  const round = epoch + 1;
  const label = `R${round} ${(phase || 'worker').replace(/_/g, ' ')}`;
  const handleClick = () => uiStore.dispatch('ui:select_session', { sessionId });

  return (
    <HStack
      gap={1}
      px={1}
      py="0.5"
      cursor="pointer"
      borderRadius="md"
      onClick={handleClick}
      role="treeitem"
      title={sessionId}
    >
      <TreeIcon status={status} />
      <Text fontSize="sm" truncate data-session-label>{label}</Text>
    </HStack>
  );
}

function NodeGroup({ nodeId, sessions }) {
  const nodeSessions = useMemo(() => 
    sessions.filter(s => s.nodeId === nodeId),
    [sessions, nodeId]
  );
  const [expanded, setExpanded] = useState(true);
  const activeSessionId = useUiState(s => s.activeSessionId);
  const node = usePathState('squad', s => s.nodes?.[nodeId]);
  const label = node?.label || node?.id || nodeId;

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
            {nodeSessions.map(session => (
              <SessionRow key={session.sessionId} sessionData={session} />
            ))}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}

export default function Sidebar() {
  const nodeMap = usePathState('squad', s => s.nodes || {});
  const sessionMap = useSessions();
  const nodes = Object.values(nodeMap);
  const sessions = Object.values(sessionMap);
  const viewMode = useUiState(s => s.viewMode || 'dag');

  const nodeIds = useMemo(() => {
    const ids = new Set(nodes.map(n => n.id));
    sessions.forEach(s => { if (s.nodeId) ids.add(s.nodeId); });
    return Array.from(ids);
  }, [nodes, sessions]);
  
  const topLevelSessions = useMemo(() => 
    sessions.filter(s => !s.nodeId),
    [sessions]
  );

  return (
    <VStack gap={1} p={4} flex="0 0 320px" minH={0} borderRight="1px solid" borderColor="border" overflowY="auto" alignItems="stretch">
      <HStack
        px={1}
        py="0.5"
        cursor="pointer"
        borderRadius="md"
        bg={viewMode === 'dag' ? 'blue.subtle' : undefined}
        color={viewMode === 'dag' ? 'blue.fg' : 'inherit'}
        fontWeight={viewMode === 'dag' ? 600 : 400}
        onClick={() => uiStore.dispatch('ui:set_view_mode', { viewMode: 'dag' })}
        gap={1}
        role="treeitem"
      >
        <Icon as={Network} boxSize={3} color="fg.subtle" />
        <Text fontSize="sm">DAG Overview</Text>
      </HStack>

      {nodeIds.map(id => (
        <NodeGroup
          key={id}
          nodeId={id}
          sessions={sessions}
        />
      ))}

      {topLevelSessions.map(session => (
        <SessionRow key={session.sessionId} sessionData={session} />
      ))}
    </VStack>
  );
}
