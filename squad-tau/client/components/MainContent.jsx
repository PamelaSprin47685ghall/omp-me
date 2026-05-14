import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Alert,
  Badge,
  Button,
  Flex,
  Box,
} from '@chakra-ui/react';
import DAGView from './DAGView.jsx';
import MessageList from './MessageList.jsx';
import { MessageInput } from './MessageInput.jsx';
import WelcomeView from './WelcomeView.jsx';

function getSessionRole(session) {
  if (!session) return 'user';
  const phase = session.phase?.toLowerCase() || '';
  if (phase.includes('worker')) return 'worker';
  if (phase.includes('reviewer')) return 'reviewer';
  if (phase.includes('outer')) return 'outer';
  return 'user';
}

function StatusTag({ session }) {
  if (!session) return null;
  const { nodeId, retryCount, phase, status } = session;
  return (
    <Flex wrap="wrap" gap={3} alignItems="center">
      {nodeId && <Badge variant="subtle" colorScheme="gray" px={2} borderRadius="full" fontSize="xs">{`Node: ${nodeId}`}</Badge>}
      {retryCount > 0 && <Badge variant="subtle" colorScheme="orange" px={2} borderRadius="full" fontSize="xs">{`Retry #${retryCount}`}</Badge>}
      <Badge variant="subtle" colorScheme="gray" px={2} borderRadius="full" fontSize="xs">{phase}</Badge>
      <Badge variant="subtle" colorScheme="gray" px={2} borderRadius="full" fontSize="xs">{status}</Badge>
    </Flex>
  );
}

function FailedBanner({ nodes, onDismiss }) {
  const failed = useMemo(
    () => Array.from(nodes.values()).filter(
      (node) => node.status === 'failed' || node.status === 'blocked'
    ),
    [nodes]
  );
  const failedCount = failed.filter((node) => node.status === 'failed').length;
  const blockedCount = failed.filter((node) => node.status === 'blocked').length;
  const reason = failed.find((node) => node.summary)?.summary || 'Unknown error';
  if (!failed.length) return null;
  return (
    <Alert.Root status="error" variant="solid">
      <Alert.Indicator />
      <Alert.Title mr={2}>Squad Failed — {failedCount} failed, {blockedCount} blocked</Alert.Title>
      <Alert.Description>{reason}</Alert.Description>
      <Box ml="auto">
        <Button size="xs" variant="outline" onClick={onDismiss}>Dismiss</Button>
      </Box>
    </Alert.Root>
  );
}

function SuccessBanner({ results }) {
  if (!results?.length) return null;
  if (results.some((result) => result.status !== 'approved')) return null;
  return (
    <Alert.Root status="success" variant="solid">
      <Alert.Indicator />
      <Alert.Title>Squad completed successfully</Alert.Title>
    </Alert.Root>
  );
}

export default function MainContent({
  viewMode, squadActive, nodes, activeSessionId, sessions, messages,
  onNodeClick, onOpenModelPool, onOptimisticMessage, send, results,
}) {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const prevSquadActive = useRef(squadActive);

  useEffect(() => {
    if (squadActive && !prevSquadActive.current) setBannerDismissed(false);
    prevSquadActive.current = squadActive;
  }, [squadActive]);

  if (!squadActive) return <WelcomeView onOpenModelPool={onOpenModelPool} />;

  if (viewMode === 'dag') {
    return (
      <Flex direction="column" gap={3} p={4} h="full" overflow="auto">
        {!bannerDismissed && <FailedBanner nodes={nodes} onDismiss={() => setBannerDismissed(true)} />}
        <SuccessBanner results={results} />
        <DAGView nodes={Array.from(nodes.values())} activeNodeId={null} onNodeClick={onNodeClick} />
      </Flex>
    );
  }

  const activeSession = [...sessions.values()].find((session) => session.sessionId === activeSessionId);
  const activeMessages = messages.get(activeSessionId) || [];
  const sessionRole = getSessionRole(activeSession);

  return (
    <Flex direction="column" gap={4} p={4} h="full">
      <StatusTag session={activeSession} />
      <Box flex={1} overflow="auto" minHeight={0}>
        <MessageList messages={activeMessages} sessionRole={sessionRole} />
      </Box>
      {activeSession && (
        <MessageInput
          sessionId={activeSessionId}
          send={send}
          onOptimisticMessage={onOptimisticMessage}
        />
      )}
    </Flex>
  );
}
