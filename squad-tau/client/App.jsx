import React, { useState, useEffect, useCallback } from 'react';
import { Classes } from '@blueprintjs/core';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import useSquadState from './hooks/useSquadState.js';
import { useSessionState } from './hooks/useSessionState.js';
import { useModelPool } from './hooks/useModelPool.js';
import ModelPoolDrawer from './components/ModelPoolDrawer.jsx';

const APP_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  overflow: 'hidden'
};

const BODY_STYLE = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden'
};

export default function App() {
  const { isDark } = useDarkMode();
  const { squad, nodes, dispatch: squadDispatch } = useSquadState();
  const { sessions, messages, activeSessionId, setActiveSessionId, dispatch: sessionDispatch } = useSessionState();
  
  const { isOpen: modelPoolOpen, openDrawer: openModelPool, closeDrawer: closeModelPool, slots, updateSlot, sendModelPoolUpdate, dispatch: modelPoolDispatch } = useModelPool();

  const handleEvent = useCallback((type, payload) => {
    switch (true) {
      case type.startsWith('squad:'): {
        const mapped = {
          'squad:init': 'SQUAD_INIT',
          'squad:complete': 'SQUAD_COMPLETE',
          'squad:abort': 'SQUAD_ABORT',
        };
        const eventType = mapped[type] || type.replace('squad:', '').toUpperCase().replace(/:/g, '_');
        squadDispatch({ type: eventType, payload });
        break;
      }
      case type.startsWith('session:'): {
        const eventType = 'SESSION_' + type.replace('session:', '').toUpperCase().replace(/:/g, '_');
        sessionDispatch({ type: eventType, payload });
        break;
      }
      case type.startsWith('model_pool:'): {
        modelPoolDispatch({ type, payload });
        break;
      }
      case type === 'connection:established':
      case type === 'connection:close':
        break;
    }
  }, [squadDispatch, sessionDispatch, modelPoolDispatch]);
  
  const { connected, send } = useWebSocket({ onEvent: handleEvent });
  
  const [dagCollapsed, setDagCollapsed] = useState(false);

  useEffect(() => {
    if (send) {
      sendModelPoolUpdate(send);
    }
  }, [send, sendModelPoolUpdate]);
  
  useEffect(() => {
    document.documentElement.classList.toggle(Classes.DARK, isDark);
  }, [isDark]);
  
  const handleToggleDAG = () => setDagCollapsed(!dagCollapsed);
  
  const handleOptimisticMessage = useCallback((msg) => {
    sessionDispatch({ type: 'SESSION_MESSAGE', payload: msg });
  }, [sessionDispatch]);
  
  const handleAbort = () => {
    send({ type: 'abort', payload: {} });
  };
  
  const handleNodeClick = (nodeId) => {
    const sessionList = Object.values(sessions);
    const nodeSession = sessionList.find(s => s.nodeId === nodeId);
    if (nodeSession) {
      setActiveSessionId(nodeSession.sessionId);
    }
  };
  
  const sessionList = Object.values(sessions).sort((a, b) => 
    parseInt(a.sessionId) - parseInt(b.sessionId)
  );
  
  const squadActive = squad !== null;
  
  return (
    <div style={APP_STYLE} className={isDark ? Classes.DARK : ''}>
      <Header
        connected={connected}
        dagCollapsed={dagCollapsed}
        onToggleDAG={handleToggleDAG}
        onOpenModelPool={openModelPool}
        squadActive={squadActive}
        onAbort={handleAbort}
      />
      <div style={BODY_STYLE}>
        <Sidebar
          sessions={sessionList}
          nodes={nodes}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
        />
        <MainContent
          squadActive={squadActive}
          nodes={nodes}
          activeSessionId={activeSessionId}
          sessions={sessions}
          messages={messages}
          dagCollapsed={dagCollapsed}
          onToggleDAG={handleToggleDAG}
          onNodeClick={handleNodeClick}
          onOpenModelPool={openModelPool}
          onOptimisticMessage={handleOptimisticMessage}
          send={send}
        />
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
