import React, { useMemo, useRef, useEffect } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  VStack,
} from '@chakra-ui/react';
import { useAppState } from '../use-app-state.js';
import { eventStore } from '../event-store.js';
import DAGView from './DAGView.jsx';
import MessageList from './MessageList.jsx';
import { MessageInput } from './MessageInput.jsx';
import WelcomeView from './WelcomeView.jsx';

export default function MainContent({
  onNodeClick, onOpenModelPool, onOptimisticMessage, send,
}) {
  const viewMode = useAppState(s => s.ui?.viewMode || 'dag');
  const activeSessionId = useAppState(s => s.ui?.activeSessionId);
  const bannerDismissed = useAppState(s => s.ui?.bannerDismissed || false);
  const prevSquadActive = useRef(false);
  const squadActive = useAppState(s => s.squad.mode && (s.squad.status === 'active' || s.squad.status === 'complete'));
  const nodes = useAppState(s => Object.values(s.squad.nodes || {}));
  const sessions = useAppState(s => s.sessions || {});
  const results = useAppState(s => s.squad.results || []);
  const messages = useAppState(s => activeSessionId ? (s.sessions[activeSessionId]?.messages || []) : []);

  useEffect(() => {
    if (squadActive && !prevSquadActive.current && bannerDismissed) {
      eventStore.dispatch('ui:dismiss_banner', {});
    }
    prevSquadActive.current = squadActive;
  }, [squadActive, bannerDismissed]);

  let content;

  if (!squadActive) {
    content = <WelcomeView onOpenModelPool={onOpenModelPool} />;
  } else if (viewMode === 'dag') {
    const allSuccess = results.length > 0 && results.every(r => r.status === 'approved');
    const showFailed = !bannerDismissed && nodes.some(n => n.status === 'failed' || n.status === 'blocked');
    const failSummary = showFailed ? nodes.reduce((acc, n) => {
      if (n.status === 'failed') acc.fc++;
      else if (n.status === 'blocked') acc.bc++;
      if (!acc.summary && n.summary) acc.summary = n.summary;
      return acc;
    }, { fc: 0, bc: 0, summary: null }) : null;
    content = (
      <VStack gap={3} p={4} h="full" overflow="auto">
        {showFailed && failSummary && (
          <Alert.Root status="error" variant="solid">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Squad Failed — {failSummary.fc} failed, {failSummary.bc} blocked</Alert.Title>
              <Alert.Description>{failSummary.summary || 'Unknown error'}</Alert.Description>
            </Alert.Content>
            <Button size="xs" variant="outline" ml="auto" onClick={() => eventStore.dispatch('ui:dismiss_banner', {})}>Dismiss</Button>
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
        <DAGView activeNodeId={null} onNodeClick={onNodeClick} />
      </VStack>
    );
  } else {
    const activeSession = Object.values(sessions).find((s) => s.sessionId === activeSessionId);
    const sessionRole = activeSession?.phase || 'user';
    content = (
      <VStack gap={4} p={4} h="full">
        {activeSession && (
          <HStack wrap="wrap">
            {activeSession.nodeId && <Badge>{`Node: ${activeSession.nodeId}`}</Badge>}
            {activeSession.retryCount > 0 && <Badge colorPalette="orange">{`Retry #${activeSession.retryCount}`}</Badge>}
            <Badge>{activeSession.phase}</Badge>
            <Badge>{activeSession.status}</Badge>
          </HStack>
        )}
        <MessageList messages={messages} sessionRole={sessionRole} flex={1} minH={0} />
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

  return <Box flex={1} minW={0} minH={0}>{content}</Box>;
}
