import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Flex } from '@chakra-ui/react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import ModelPoolDrawer from './components/ModelPoolDrawer.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { eventStore } from './event-store.js';

export default function App() {
  const { isDark } = useDarkMode();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const { connected, send } = useWebSocket();
  const [viewMode, setViewMode] = useState('dag');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [modelPoolOpen, setModelPoolOpen] = useState(false);
  const sendRef = useRef(null);

  useEffect(() => { sendRef.current = send; }, [send]);

  const selectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    setViewMode('session');
  }, []);

  const handleNodeClick = useCallback((nodeId) => {
    const state = eventStore.getState();
    const session = Object.values(state.sessions).find(s => s.nodeId === nodeId);
    if (session) selectSession(session.sessionId);
  }, [selectSession]);

  const handleOptimisticMessage = useCallback((msg) => {
    eventStore.dispatch('session:message', msg);
  }, []);

  const handleAbort = useCallback(() => {
    if (sendRef.current) sendRef.current({ type: 'abort', payload: {} });
  }, []);

  const handleUpdateSlot = useCallback((action, slot, slotId, thinkingLevel) => {
    if (!sendRef.current) return;
    sendRef.current({ type: 'model_pool:update', payload: { action, slot, slotId, thinkingLevel } });
  }, []);

  return (
    <Flex direction="column" minH="100vh" w="full">
      <Header
        connected={connected}
        onOpenModelPool={() => setModelPoolOpen(true)}
        onAbort={handleAbort}
      />
      <Flex flex={1} minH={0}>
        <Sidebar
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          viewMode={viewMode}
          onSelectDAG={() => setViewMode('dag')}
        />
        <MainContent
          viewMode={viewMode}
          activeSessionId={activeSessionId}
          onNodeClick={handleNodeClick}
          onOpenModelPool={() => setModelPoolOpen(true)}
          onOptimisticMessage={handleOptimisticMessage}
          send={send}
        />
      </Flex>
      <ModelPoolDrawer
        isOpen={modelPoolOpen}
        onClose={() => setModelPoolOpen(false)}
        onUpdateSlot={handleUpdateSlot}
      />
    </Flex>
  );
}
