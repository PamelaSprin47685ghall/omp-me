import React, { useMemo } from 'react';
import { Button, Icon, Card } from '@blueprintjs/core';
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

function useMessageDetails(activeMessages, activeSessionId) {
  return useMemo(() => {
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
}

function WelcomeOrErrorSection({ squadActive, onOpenModelPool, failedNodes, results }) {
  if (!squadActive) {
    return (
      <div style={MAIN_STYLE}>
        <WelcomeView onOpenModelPool={onOpenModelPool} />
      </div>
    );
  }
  if (failedNodes.length > 0) return <ErrorBanner nodes={failedNodes} />;
  
  if (results && results.length > 0) {
    return (
      <Card style={{ marginBottom: 12 }} elevation={2}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0F9960' }}>
          <Icon icon={IconNames.TICK_CIRCLE} size={20} />
          <span style={{ fontWeight: 600 }}>Squad Completed Successfully</span>
        </div>
      </Card>
    );
  }
  
  return null;
}

function StatusBarSection({ activeSession }) {
  if (!activeSession) return null;
  return (
    <StatusBar
      nodeId={activeSession.nodeId}
      retryCount={activeSession.retryCount}
      phase={activeSession.phase}
      status={activeSession.status}
      mode={null}
      currentLayer={null}
      totalLayers={null}
    />
  );
}

function MessageListSection({ activeMessages, sessionRole, details }) {
  return (
    <MessageList 
      messages={activeMessages} 
      sessionRole={sessionRole}
      deltas={details.deltas}
      toolCalls={details.toolCalls}
      toolResults={details.toolResults}
    />
  );
}

function InputSection({ activeSession, activeSessionId, send, onOptimisticMessage }) {
  if (!activeSession) return null;
  const reason = (['completed', 'aborted', 'error'].includes(activeSession.status) || 
                  ['completed', 'aborted', 'error'].includes(activeSession.phase))
    ? (activeSession.status !== 'active' ? activeSession.status : activeSession.phase) 
    : null;
    
  return (
    <MessageInput
      sessionId={activeSessionId}
      sessionEndReason={reason}
      send={send}
      onOptimisticMessage={onOptimisticMessage}
    />
  );
}

function useFailedNodes(nodes) {
  return useMemo(() => {
    const failed = [];
    nodes.forEach(node => {
      if (node.status === 'failed' || node.status === 'blocked') {
        failed.push(node);
      }
    });
    return failed;
  }, [nodes]);
}

function DAGSection({ nodes, activeSession, dagCollapsed, onNodeClick }) {
  if (dagCollapsed) return null;
  return (
    <DAGView
      nodes={Array.from(nodes.values())}
      activeNodeId={activeSession?.nodeId}
      onNodeClick={onNodeClick}
    />
  );
}

export default function MainContent({
  squadActive, nodes, activeSessionId, sessions, messages,
  dagCollapsed, onToggleDAG, onNodeClick, onOpenModelPool,
  onOptimisticMessage, send, results
}) {
  const activeSession = Array.isArray(sessions)
    ? sessions.find(s => s.sessionId === activeSessionId)
    : sessions[activeSessionId];
  const activeMessages = messages[activeSessionId] || [];
  const sessionRole = getSessionRole(activeSession);
  const details = useMessageDetails(activeMessages, activeSessionId);
  const failedNodes = useFailedNodes(nodes);
  
  if (!squadActive) {
    return <WelcomeOrErrorSection squadActive={false} onOpenModelPool={onOpenModelPool} />;
  }
  
  return (
    <div style={MAIN_STYLE}>
      <WelcomeOrErrorSection squadActive={true} failedNodes={failedNodes} results={results} />
      <DAGSection
        nodes={nodes} activeSession={activeSession}
        dagCollapsed={dagCollapsed} onNodeClick={onNodeClick}
      />
      <StatusBarSection activeSession={activeSession} />
      <MessageListSection activeMessages={activeMessages} sessionRole={sessionRole} details={details} />
      <InputSection
        activeSession={activeSession} activeSessionId={activeSessionId}
        send={send} onOptimisticMessage={onOptimisticMessage}
      />
    </div>
  );
}


