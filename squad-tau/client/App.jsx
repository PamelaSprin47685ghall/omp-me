import React, { useState, useEffect, useCallback } from 'react';
import { Classes } from '@blueprintjs/core';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import useDarkMode from './hooks/useDarkMode.js';
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
  const isDark = useDarkMode();
  const { squad, nodes, dispatch: squadDispatch } = useSquadState();
  const { sessions, messages, activeSessionId, setActiveSessionId, dispatch: sessionDispatch } = useSessionState();
  
  const handleEvent = useCallback((type, payload) => {
    if (type.startsWith('squad:')) {
      const eventType = type.replace('squad:', '').toUpperCase().replace(/:/g, '_');
      squadDispatch({ type: eventType, payload });
    } else if (type.startsWith('session:')) {
      const eventType = type.replace('session:', '').toUpperCase().replace(/:/g, '_');
      sessionDispatch({ type: eventType, payload });
    }
  }, [squadDispatch, sessionDispatch]);
  
  const { connected, send } = useWebSocket({ port: 9527, onEvent: handleEvent });
  
  const [dagCollapsed, setDagCollapsed] = useState(false);
  const { isOpen: modelPoolOpen, openDrawer: openModelPool, closeDrawer: closeModelPool, slots, updateSlot, sendModelPoolUpdate } = useModelPool();

  useEffect(() => {
    if (send) {
      sendModelPoolUpdate(send);
    }
  }, [send, sendModelPoolUpdate]);
  
  useEffect(() => {
    if (isDark) {
      document.body.classList.add(Classes.DARK);
    } else {
      document.body.classList.remove(Classes.DARK);
    }
  }, [isDark]);
  
  const handleToggleDAG = () => setDagCollapsed(!dagCollapsed);
  
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
