import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import ModelPoolDrawer from './components/ModelPoolDrawer.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import useSquadState from './hooks/useSquadState.js';
import { useSessionState } from './hooks/useSessionState.js';
import { useModelPool } from './hooks/useModelPool.js';

const APP_ROOT_STYLE = { minHeight: '100vh', display: 'flex', flexDirection: 'column' };
const APP_BODY_STYLE = { display: 'flex', flex: 1, minHeight: 0 };
const SIDEBAR_STYLE = { width: 320, flex: '0 0 320px', minHeight: 0 };
const MAIN_STYLE = { flex: 1, minWidth: 0, minHeight: 0 };

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
    document.documentElement.classList.toggle('bp6-dark', isDark);
  }, [isDark]);

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
    <div className={`app-root ${isDark ? 'bp6-dark' : ''}`} style={APP_ROOT_STYLE}>
      <Header
        connected={connected}
        onOpenModelPool={openModelPool}
        squadActive={squadActive}
        onAbort={() => send({ type: 'abort', payload: {} })}
      />
      <div style={APP_BODY_STYLE}>
        <div style={SIDEBAR_STYLE}>
          <Sidebar
            sessions={sessionList}
            nodes={nodes}
            activeSessionId={activeSessionId}
            onSelectSession={selectSession}
            viewMode={viewMode}
            onSelectDAG={() => setViewMode('dag')}
          />
        </div>
        <div style={MAIN_STYLE}>
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
        </div>
      </div>
      <ModelPoolDrawer
        isOpen={modelPoolOpen}
        onClose={closeModelPool}
        slots={slots}
        onUpdateSlot={updateSlot}
      />
    </div>
  );
}
