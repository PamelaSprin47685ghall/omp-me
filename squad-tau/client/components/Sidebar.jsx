import React, { useState, useEffect, useMemo } from 'react';
import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import SessionTree from './SessionTree.jsx';

const SIDEBAR_STYLE = {
  width: 280,
  height: '100%',
  borderRight: '1px solid #ccc',
  overflowY: 'auto',
  padding: 8,
  position: 'relative'
};

const LOCK_BUTTON_STYLE = {
  position: 'absolute',
  top: 8,
  right: 8,
  cursor: 'pointer',
  padding: 4,
  zIndex: 10
};

function getStatusIcon(status) {
  switch (status) {
    case 'approved': return IconNames.TICK_CIRCLE;
    case 'rejected': return IconNames.CROSS_CIRCLE;
    case 'pending': return IconNames.TIME;
    case 'authoring':
    case 'confirming':
    case 'reviewing':
    case 'active': return IconNames.REFRESH;
    case 'failed':
    case 'blocked': return IconNames.BAN_CIRCLE;
    default: return IconNames.HELP;
  }
}

function sortTreeNodes(nodeMap) {
  const sortedNodes = Array.from(nodeMap.values()).sort((a, b) => 
    String(a.firstSessionId).localeCompare(String(b.firstSessionId))
  );
  
  sortedNodes.forEach(node => {
    node.childNodes.sort((a, b) => 
      String(a.sessionId).localeCompare(String(b.sessionId))
    );
  });
  
  return sortedNodes;
}

function buildTreeNodes(sessions, nodes) {
  const nodeMap = new Map();
  const topLevelNodes = [];
  
  sessions.forEach(session => {
    const { sessionId, nodeId, phase, retryCount, status } = session;
    
    if (!nodeId) {
      // Main/architect and outer_review sessions have no nodeId — show as top-level
      topLevelNodes.push({
        id: sessionId,
        label: phase === 'outer_review' ? 'Outer Review' : 'Architect',
        icon: getStatusIcon(status || 'pending'),
        isExpanded: true,
        childNodes: [],
        sessionId
      });
      return;
    }
    
    if (!nodeMap.has(nodeId)) {
      const nodeInfo = nodes.get(nodeId);
      nodeMap.set(nodeId, {
        id: nodeId,
        label: nodeId,
        icon: getStatusIcon(nodeInfo?.status || 'pending'),
        isExpanded: true,
        childNodes: [],
        firstSessionId: sessionId
      });
    }
    
    nodeMap.get(nodeId).childNodes.push({
      id: sessionId,
      label: `R${retryCount != null ? retryCount + 1 : 1}-${phase}`,
      icon: getStatusIcon(status || 'pending'),
      sessionId
    });
  });
  
  const sortedNodes = sortTreeNodes(nodeMap);
  return [...sortedNodes, ...topLevelNodes];
}

function useAutoSelectSession(sessions, activeSessionId, onSelectSession, locked) {
  useEffect(() => {
    if (!locked && sessions.length > 0) {
      const latestSession = sessions[sessions.length - 1];
      if (latestSession.sessionId !== activeSessionId) {
        onSelectSession(latestSession.sessionId);
      }
    }
  }, [sessions, locked, activeSessionId, onSelectSession]);
}

export default function Sidebar({ sessions, nodes, activeSessionId, onSelectSession }) {
  const [locked, setLocked] = useState(false);
  const treeNodes = useMemo(() => buildTreeNodes(sessions, nodes), [sessions, nodes]);
  
  useAutoSelectSession(sessions, activeSessionId, onSelectSession, locked);
  
  const handleNodeClick = (sessionId) => {
    onSelectSession(sessionId);
    setLocked(true);
  };
  
  return (
    <div style={SIDEBAR_STYLE}>
      {locked && (
        <div style={LOCK_BUTTON_STYLE} onClick={() => setLocked(false)}>
          <Icon icon={IconNames.LOCK} size={14} />
        </div>
      )}
      <SessionTree 
        nodes={treeNodes}
        activeSessionId={activeSessionId}
        onNodeClick={handleNodeClick}
      />
    </div>
  );
}
