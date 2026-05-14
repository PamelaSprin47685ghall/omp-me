import React, { useEffect, useRef } from 'react';
import { Flex } from '@chakra-ui/react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import ModelPoolDrawer from './components/ModelPoolDrawer.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { eventStore } from './event-store.js';
import { useAppState } from './use-app-state.js';

export default function App() {
  const { isDark } = useDarkMode();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const { connected, send } = useWebSocket();
  const sendRef = useRef(null);
  useEffect(() => { sendRef.current = send; }, [send]);

  const selectSession = (sessionId) => {
    eventStore.dispatch('ui:select_session', { sessionId });
  };

  const selectDAG = () => {
    eventStore.dispatch('ui:set_view_mode', { viewMode: 'dag' });
  };

  const handleNodeClick = (nodeId) => {
    const state = eventStore.getState();
    const session = Object.values(state.sessions).find((s) => s.nodeId === nodeId);
    if (session) selectSession(session.sessionId);
  };

  const handleOptimisticMessage = (msg) => {
    eventStore.dispatch('session:message', msg);
  };

  const handleAbort = () => {
    if (sendRef.current) sendRef.current({ type: 'abort', payload: {} });
  };

  const modelPoolOpen = useAppState(s => s.ui?.modelPoolOpen || false);
  const viewMode = useAppState(s => s.ui?.viewMode || 'dag');
  const activeSessionId = useAppState(s => s.ui?.activeSessionId);

  return (
    <Flex direction="column" minH="100vh" w="full">
      <Header
        connected={connected}
        onOpenModelPool={() => eventStore.dispatch('ui:toggle_drawer', { open: true })}
        onAbort={handleAbort}
      />
      <Flex flex={1} minH={0}>
        <Sidebar activeSessionId={activeSessionId} onSelectSession={selectSession} viewMode={viewMode} onSelectDAG={selectDAG} />
        <MainContent
          onNodeClick={handleNodeClick}
          onOpenModelPool={() => eventStore.dispatch('ui:toggle_drawer', { open: true })}
          onOptimisticMessage={handleOptimisticMessage}
          send={send}
        />
      </Flex>
      <ModelPoolDrawer isOpen={modelPoolOpen} onClose={() => eventStore.dispatch('ui:toggle_drawer', { open: false })} />
    </Flex>
  );
}
