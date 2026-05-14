import React, { useState, useEffect, useCallback } from 'react';
import { Flex } from '@chakra-ui/react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import ModelPoolDrawer from './components/ModelPoolDrawer.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import useSquadState from './hooks/useSquadState.js';
import { useSessionState } from './hooks/useSessionState.js';
import { useModelPool } from './hooks/useModelPool.js';
import { streamingManager } from './streaming-manager.js';
import { eventStore } from './event-store.js';

export default function App() {
  const { isDark } = useDarkMode();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const { squad, nodes, results, dispatch: squadDispatch } = useSquadState();
  const { sessions, messages, activeSessionId, setActiveSessionId, dispatch: sessionDispatch } = useSessionState();
  const { isOpen: modelPoolOpen, openDrawer: openModelPool, closeDrawer: closeModelPool, slots, updateSlot, sendModelPoolUpdate, dispatch: modelPoolDispatch } = useModelPool();

  const handleEvent = useCallback((type, payload) => {
    // legacy logging or debugging
    if (type === 'error') console.error('[App] WS error:', payload);
  }, []);

  const { connected, send } = useWebSocket({ onEvent: handleEvent });
  const [viewMode, setViewMode] = useState('dag');

  const selectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    setViewMode('session');
  }, [setActiveSessionId]);

  useEffect(() => {
    if (send) sendModelPoolUpdate(send);
  }, [send, sendModelPoolUpdate]);

  useEffect(() => {
    window.__squadState = { squad, nodes, results };
  }, [squad, nodes, results]);

  useEffect(() => {
    window.__sessionState = { sessions, messages, activeSessionId };
  }, [sessions, messages, activeSessionId]);

  useEffect(() => {
    window.__squadEventBus = handleEvent;
    window.__setActiveSessionId = setActiveSessionId;
    window.__resetEventStore = () => eventStore.reset();
    window.__injectEvents = (events) => {
      for (const e of events) eventStore.dispatch(e.type, e.payload, e.seq);
      return new Promise(r => requestAnimationFrame(r));
    };
    window.__selectLatestSession = () => {
      const sessionValues = Object.values(sessions);
      if (sessionValues.length > 0) selectSession(sessionValues[sessionValues.length - 1].sessionId);
    };
  }, [handleEvent, setActiveSessionId, sessions, selectSession]);

  const handleNodeClick = (nodeId) => {
    const sessionsForNode = Object.values(sessions).filter((session) => session.nodeId === nodeId);
    if (sessionsForNode.length > 0) {
      selectSession(sessionsForNode[sessionsForNode.length - 1].sessionId);
    }
  };

  const sessionList = Object.values(sessions);
  const squadActive = squad !== null && squad.status === 'active';

  return (
    <Flex direction="column" minH="100vh" w="full">
      <Header
        connected={connected}
        onOpenModelPool={openModelPool}
        squadActive={squadActive}
        onAbort={() => send({ type: 'abort', payload: {} })}
      />
      <Flex flex={1} minH={0}>
        <Sidebar
          sessions={sessionList}
          nodes={nodes}
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          viewMode={viewMode}
          onSelectDAG={() => setViewMode('dag')}
        />
        <MainContent
            viewMode={viewMode}
            squadActive={squadActive}
            nodes={nodes}
            activeSessionId={activeSessionId}
            sessions={sessionList}
            messages={messages}
            onNodeClick={handleNodeClick}
            onOpenModelPool={openModelPool}
            onOptimisticMessage={(msg) => sessionDispatch({ type: 'SESSION_MESSAGE', payload: msg })}
            send={send}
            results={results}
          />
      </Flex>
      <ModelPoolDrawer
        isOpen={modelPoolOpen}
        onClose={closeModelPool}
        slots={slots}
        onUpdateSlot={updateSlot}
      />
    </Flex>
  );
}
