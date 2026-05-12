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

function useAppEventHandlers(squadDispatch, sessionDispatch, modelPoolDispatch) {
  return useCallback((type, payload) => {
    if (type.startsWith('squad:')) {
      const mapped = {
        'squad:init': 'SQUAD_INIT',
        'squad:complete': 'SQUAD_COMPLETE',
        'squad:abort': 'SQUAD_ABORT',
      };
      const eventType = mapped[type] || type.replace('squad:', '').toUpperCase().replace(/:/g, '_');
      squadDispatch({ type: eventType, payload });
    } else if (type.startsWith('session:')) {
      const eventType = 'SESSION_' + type.replace('session:', '').toUpperCase().replace(/:/g, '_');
      sessionDispatch({ type: eventType, payload });
    } else if (type.startsWith('model_pool:')) {
      modelPoolDispatch({ type, payload });
    } else if (type === 'error') {
      // Handle generic error events (e.g., from ws-handler)
      console.error('[App] Server Error:', payload.message);
      // Optional: Add to a global toast or similar if needed
    }
  }, [squadDispatch, sessionDispatch, modelPoolDispatch]);
}

function MainLayoutContent({
  sessions, nodes, activeSessionId, setActiveSessionId,
  messages, dagCollapsed, onToggleDAG, handleNodeClick,
  openModelPool, onOptimisticMessage, send, squadActive, results
}) {
  return (
    <div style={BODY_STYLE}>
      <Sidebar
        sessions={sessions}
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
        onToggleDAG={onToggleDAG}
        onNodeClick={handleNodeClick}
        onOpenModelPool={openModelPool}
        onOptimisticMessage={onOptimisticMessage}
        send={send}
        results={results}
      />
    </div>
  );
}

function AppLayout({ 
  isDark, connected, dagCollapsed, onToggleDAG, openModelPool, closeModelPool, 
  squadActive, onAbort, sessions, nodes, activeSessionId, setActiveSessionId,
  messages, onOptimisticMessage, send, modelPoolOpen, slots, updateSlot,
  handleNodeClick, results
}) {
  return (
    <div style={APP_STYLE} className={isDark ? Classes.DARK : ''}>
      <Header
        connected={connected}
        dagCollapsed={dagCollapsed}
        onToggleDAG={onToggleDAG}
        onOpenModelPool={openModelPool}
        squadActive={squadActive}
        onAbort={onAbort}
      />
      <MainLayoutContent
        sessions={sessions}
        nodes={nodes}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        messages={messages}
        dagCollapsed={dagCollapsed}
        onToggleDAG={onToggleDAG}
        handleNodeClick={handleNodeClick}
        openModelPool={openModelPool}
        onOptimisticMessage={onOptimisticMessage}
        send={send}
        squadActive={squadActive}
        results={results}
      />
      <ModelPoolDrawer
        isOpen={modelPoolOpen}
        onClose={closeModelPool}
        slots={slots}
        onUpdateSlot={updateSlot}
      />
    </div>
  );
}

function useAppEffects(isDark, send, sendModelPoolUpdate) {
  useEffect(() => {
    if (send) sendModelPoolUpdate(send);
  }, [send, sendModelPoolUpdate]);
  
  useEffect(() => {
    document.documentElement.classList.toggle(Classes.DARK, isDark);
  }, [isDark]);
}

export default function App() {
  const { isDark } = useDarkMode();
  const { squad, nodes, results, dispatch: squadDispatch } = useSquadState();
  const { sessions, messages, activeSessionId, setActiveSessionId, dispatch: sessionDispatch } = useSessionState();
  const { isOpen: modelPoolOpen, openDrawer: openModelPool, closeDrawer: closeModelPool, slots, updateSlot, sendModelPoolUpdate, dispatch: modelPoolDispatch } = useModelPool();

  const handleEvent = useAppEventHandlers(squadDispatch, sessionDispatch, modelPoolDispatch);
  const { connected, send } = useWebSocket({ onEvent: handleEvent });
  const [dagCollapsed, setDagCollapsed] = useState(false);

  useAppEffects(isDark, send, sendModelPoolUpdate);

  // Expose APIs for test/synthetic event injection
  useEffect(() => {
    window.__squadEventBus = handleEvent;
    window.__setActiveSessionId = setActiveSessionId;
  }, [handleEvent, setActiveSessionId]);

  const handleNodeClick = (nodeId) => {
    const nodeSession = Object.values(sessions).find(s => s.nodeId === nodeId);
    if (nodeSession) setActiveSessionId(nodeSession.sessionId);
  };
  
  const sessionList = Object.values(sessions).sort((a, b) => 
    parseInt(a.sessionId) - parseInt(b.sessionId)
  );

  return (
    <AppLayout
      isDark={isDark} connected={connected} dagCollapsed={dagCollapsed}
      onToggleDAG={() => setDagCollapsed(!dagCollapsed)}
      openModelPool={openModelPool} closeModelPool={closeModelPool}
      squadActive={squad !== null} onAbort={() => send({ type: 'abort', payload: {} })}
      sessions={sessionList} nodes={nodes} activeSessionId={activeSessionId}
      setActiveSessionId={setActiveSessionId} messages={messages}
      onOptimisticMessage={(msg) => sessionDispatch({ type: 'SESSION_MESSAGE', payload: msg })}
      send={send} modelPoolOpen={modelPoolOpen} slots={slots}
      updateSlot={updateSlot} handleNodeClick={handleNodeClick}
      results={results}
    />
  );
}

