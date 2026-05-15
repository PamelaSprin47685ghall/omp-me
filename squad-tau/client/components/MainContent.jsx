import React, { useEffect } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  VStack,
} from '@chakra-ui/react';
import { usePathState } from '../hooks/useAtomicState.js';
import { eventStore } from '../event-store.js';
import DAGView from './DAGView.jsx';
import MessageList from './MessageList.jsx';
import { MessageInput } from './MessageInput.jsx';
import WelcomeView from './WelcomeView.jsx';

export default function MainContent() {
  const viewMode = usePathState('ui', s => s.ui?.viewMode || 'dag');
  const activeSessionId = usePathState('ui', s => s.ui?.activeSessionId);
  const bannerDismissed = usePathState('ui', s => s.ui?.bannerDismissed || false);
  const squadActive = usePathState('squad', s => s.squad.mode && (s.squad.status === 'active' || s.squad.status === 'complete'));
  const nodes = usePathState('squad', s => Object.values(s.squad.nodes || {}));
  const sessions = usePathState('sessions', s => s.sessions || {});
  const results = usePathState('squad', s => s.squad.results || []);

  let content;

  if (!squadActive) {
    content = <WelcomeView />;
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
        <DAGView />
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
        <MessageList flex={1} minH={0} />
        <MessageInput />
      </VStack>
    );
  }

  return <Box flex={1} minW={0} minH={0}>{content}</Box>;
}
