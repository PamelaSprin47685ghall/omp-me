import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Alert,
  Badge,
  Button,
  HStack,
  VStack,
} from '@chakra-ui/react';
import DAGView from './DAGView.jsx';
import MessageList from './MessageList.jsx';
import { MessageInput } from './MessageInput.jsx';
import WelcomeView from './WelcomeView.jsx';

export default function MainContent({
  viewMode, squadActive, nodes, activeSessionId, sessions, messages,
  onNodeClick, onOpenModelPool, onOptimisticMessage, send, results,
}) {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const prevSquadActive = useRef(squadActive);
  const failedNodes = useMemo(
    () => Array.from(nodes.values()).filter(
      (node) => node.status === 'failed' || node.status === 'blocked'
    ),
    [nodes]
  );

  useEffect(() => {
    if (squadActive && !prevSquadActive.current) setBannerDismissed(false);
    prevSquadActive.current = squadActive;
  }, [squadActive]);

  if (!squadActive) return <WelcomeView onOpenModelPool={onOpenModelPool} />;

  if (viewMode === 'dag') {
    const allSuccess = results?.length > 0 && results.every(r => r.status === 'approved');
    const showFailed = !bannerDismissed && failedNodes.length > 0;
    const fc = failedNodes.filter(n => n.status === 'failed').length;
    const bc = failedNodes.filter(n => n.status === 'blocked').length;
    const failReason = failedNodes.find(n => n.summary)?.summary || 'Unknown error';
    return (
      <VStack gap={3} p={4} h="full" overflow="auto">
        {showFailed && (
          <Alert.Root status="error" variant="solid">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Squad Failed — {fc} failed, {bc} blocked</Alert.Title>
              <Alert.Description>{failReason}</Alert.Description>
            </Alert.Content>
            <Button size="xs" variant="outline" ml="auto" onClick={() => setBannerDismissed(true)}>Dismiss</Button>
          </Alert.Root>
        )}
        {allSuccess && (
          <Alert.Root status="success" variant="solid">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Squad completed successfully</Alert.Title>
            </Alert.Content>
          </Alert.Root>
        )}
        <DAGView nodes={Array.from(nodes.values())} activeNodeId={null} onNodeClick={onNodeClick} />
      </VStack>
    );
  }

  const activeSession = [...sessions.values()].find((s) => s.sessionId === activeSessionId);
  const activeMessages = messages.get(activeSessionId) || [];
  const sessionRole = (!activeSession) ? 'user'
    : activeSession.phase?.toLowerCase().includes('worker') ? 'worker'
    : activeSession.phase?.toLowerCase().includes('reviewer') ? 'reviewer'
    : activeSession.phase?.toLowerCase().includes('outer') ? 'outer'
    : 'user';

  return (
    <VStack gap={4} p={4} h="full">
      {activeSession && (
        <HStack wrap="wrap">
          {activeSession.nodeId && <Badge colorPalette="gray">{`Node: ${activeSession.nodeId}`}</Badge>}
          {activeSession.retryCount > 0 && <Badge colorPalette="orange">{`Retry #${activeSession.retryCount}`}</Badge>}
          <Badge colorPalette="gray">{activeSession.phase}</Badge>
          <Badge colorPalette="gray">{activeSession.status}</Badge>
        </HStack>
      )}
      <MessageList messages={activeMessages} sessionRole={sessionRole} flex={1} minH={0} />
      {activeSession && (
        <MessageInput
          sessionId={activeSessionId}
          send={send}
          onOptimisticMessage={onOptimisticMessage}
        />
      )}
    </VStack>
  );
}
