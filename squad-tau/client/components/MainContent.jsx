import React, { useMemo } from 'react';
import { Button, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import DAGView from './DAGView.jsx';
import MessageItem from './MessageItem.jsx';
import { MessageInput } from './MessageInput.jsx';
import StatusBar from './StatusBar.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import MessageList from './MessageList.jsx';
import WelcomeView from './WelcomeView.jsx';

const MAIN_STYLE = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden'
};

function getSessionRole(session) {
  if (!session) return 'user';
  const phase = session.phase?.toLowerCase() || '';
  if (phase.includes('worker')) return 'worker';
  if (phase.includes('reviewer')) return 'reviewer';
  if (phase.includes('outer')) return 'outer';
  return 'user';
}

export default function MainContent({
  squadActive,
  nodes,
  activeSessionId,
  sessions,
  messages,
  dagCollapsed,
  onToggleDAG,
  onNodeClick,
  onOpenModelPool,
  send
}) {
  const activeSession = sessions[activeSessionId];
  const activeMessages = messages[activeSessionId] || [];
  const sessionRole = getSessionRole(activeSession);
  
  const { deltas, toolCalls, toolResults } = useMemo(() => {
    const deltas = [];
    const toolCalls = [];
    const toolResults = [];
    
    activeMessages.forEach(msg => {
      if (!msg.content || !Array.isArray(msg.content)) return;
      
      msg.content.forEach(block => {
        if (block.type === 'tool_call') {
          toolCalls.push({
            sessionId: activeSessionId,
            messageId: msg.messageId,
            toolName: block.toolName,
            toolId: block.toolId,
            params: block.params
          });
          
          if (block.result !== undefined) {
            toolResults.push({
              sessionId: activeSessionId,
              toolId: block.toolId,
              result: block.result,
              isError: block.isError || false
            });
          }
        }
      });
    });
    
    return { deltas, toolCalls, toolResults };
  }, [activeMessages, activeSessionId]);
  
  const failedNodes = useMemo(() => {
    const failed = [];
    nodes.forEach(node => {
      if (node.status === 'failed' || node.status === 'blocked') {
        failed.push(node);
      }
    });
    return failed;
  }, [nodes]);
  
  const showError = failedNodes.length > 0;
  
  if (!squadActive) {
    return (
      <div style={MAIN_STYLE}>
        <WelcomeView onOpenModelPool={onOpenModelPool} />
      </div>
    );
  }
  
  const handleOptimisticMessage = (msg) => {
    // Optimistic update handled by parent
  };
  
  const sessionEndReason = 
    activeSession?.status === 'completed' || 
    activeSession?.status === 'aborted' || 
    activeSession?.status === 'error' 
      ? activeSession.status 
      : null;
  
  return (
    <div style={MAIN_STYLE}>
      {showError && <ErrorBanner nodes={failedNodes} />}
      
      {!dagCollapsed && (
        <DAGView
          nodes={Array.from(nodes.values())}
          activeNodeId={activeSession?.nodeId}
          onNodeClick={onNodeClick}
          collapsed={dagCollapsed}
          onToggle={onToggleDAG}
        />
      )}
      
      {activeSession && (
        <StatusBar
          nodeId={activeSession.nodeId}
          retryCount={activeSession.retryCount}
          phase={activeSession.phase}
          status={activeSession.status}
          mode={null}
          currentLayer={null}
          totalLayers={null}
        />
      )}
      
      <MessageList 
        messages={activeMessages} 
        sessionRole={sessionRole}
        deltas={deltas}
        toolCalls={toolCalls}
        toolResults={toolResults}
      />
      
      {activeSession && (
        <MessageInput
          sessionId={activeSessionId}
          sessionEndReason={sessionEndReason}
          send={send}
          onOptimisticMessage={handleOptimisticMessage}
        />
      )}
    </div>
  );
}
