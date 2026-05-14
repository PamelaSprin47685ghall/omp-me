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

function useAppEventHandlers(squadDispatch, sessionDispatch, modelPoolDispatch) {
  return useCallback((type, payload) => {
    if (type.startsWith('squad:')) {
      const mapped = {
        'squad:init': 'SQUAD_INIT',
        'squad:node_state': 'NODE_STATE',
        'squad:complete': 'SQUAD_COMPLETE',
        'squad:abort': 'SQUAD_ABORT',
        'squad:outer_review_start': 'SQUAD_OUTER_REVIEW_START',
        'squad:outer_review_result': 'SQUAD_OUTER_REVIEW_RESULT',
      };
      const eventType = mapped[type] || type.replace('squad:', '').toUpperCase().replace(/:/g, '_');
      squadDispatch({ type: eventType, payload });
      return;
    }

    if (type.startsWith('session:')) {
      const eventType = 'SESSION_' + type.replace('session:', '').toUpperCase().replace(/:/g, '_');
      sessionDispatch({ type: eventType, payload });
      return;
    }

    if (type.startsWith('model_pool:')) {
      modelPoolDispatch({ type, payload });
      return;
    }

    if (type === 'error') {
      console.error('[App] WS error:', payload);
    }
  }, [squadDispatch, sessionDispatch, modelPoolDispatch]);
}

export default function App() {
  const { isDark } = useDarkMode();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const { squad, nodes, results, dispatch: squadDispatch } = useSquadState();
  const { sessions, messages, activeSessionId, setActiveSessionId, dispatch: sessionDispatch } = useSessionState();
  const { isOpen: modelPoolOpen, openDrawer: openModelPool, closeDrawer: closeModelPool, slots, updateSlot, sendModelPoolUpdate, dispatch: modelPoolDispatch } = useModelPool();

  const handleEvent = useAppEventHandlers(squadDispatch, sessionDispatch, modelPoolDispatch);
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
    window.__squadEventBus = handleEvent;
    window.__setActiveSessionId = setActiveSessionId;
    window.__selectLatestSession = () => {
      const sessionValues = [...sessions.values()];
      if (sessionValues.length > 0) selectSession(sessionValues[sessionValues.length - 1].sessionId);
    };
  }, [handleEvent, setActiveSessionId, sessions, selectSession]);

  const handleNodeClick = (nodeId) => {
    const sessionsForNode = [...sessions.values()].filter((session) => session.nodeId === nodeId);
    if (sessionsForNode.length > 0) {
      selectSession(sessionsForNode[sessionsForNode.length - 1].sessionId);
    }
  };

  const sessionList = [...sessions.values()];
  const squadActive = squad !== null;

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
