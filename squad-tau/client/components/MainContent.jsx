import React, { useMemo } from 'react';
import { Callout, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import DAGView from './DAGView.jsx';
import MessageList from './MessageList.jsx';
import { MessageInput } from './MessageInput.jsx';
import WelcomeView from './WelcomeView.jsx';

function getSessionRole(session) {
  if (!session) return 'user';
  const phase = session.phase?.toLowerCase() || '';
  if (phase.includes('worker')) return 'worker';
  if (phase.includes('reviewer')) return 'reviewer';
  if (phase.includes('outer')) return 'outer';
  return 'user';
}

function StatusTag({ session }) {
  if (!session) return null;
  const { nodeId, retryCount, phase, status } = session;
  return (
    <div className="status-bar">
      {nodeId && <Tag minimal>Node: {nodeId}</Tag>}
      {retryCount > 0 && <Tag minimal intent="warning">Retry #{retryCount}</Tag>}
      <Tag minimal>{phase}</Tag>
      <Tag minimal>{status}</Tag>
    </div>
  );
}

function FailedBanner({ nodes }) {
  const failed = useMemo(() =>
    Array.from(nodes.values()).filter(n => n.status === 'failed' || n.status === 'blocked'),
  [nodes]);
  if (!failed.length) return null;
  return (
    <Callout intent="danger" icon={IconNames.ERROR} className="banner">
      {failed.length} node(s) failed: {failed.map(n => n.id).join(', ')}
    </Callout>
  );
}

function SuccessBanner({ results }) {
  if (!results?.length) return null;
  return (
    <Callout intent="success" icon={IconNames.TICK_CIRCLE} className="banner">
      Squad completed successfully
    </Callout>
  );
}

export default function MainContent({
  viewMode, squadActive, nodes, activeSessionId, sessions, messages,
  onNodeClick, onOpenModelPool, onOptimisticMessage, send, results
}) {
  if (!squadActive) return <WelcomeView onOpenModelPool={onOpenModelPool} />;

  if (viewMode === 'dag') {
    return (
      <div className="app-main">
        <FailedBanner nodes={nodes} />
        <SuccessBanner results={results} />
        <DAGView nodes={Array.from(nodes.values())} activeNodeId={null} onNodeClick={onNodeClick} />
      </div>
    );
  }

  const activeSession = sessions.find(s => s.sessionId === activeSessionId);
  const activeMessages = messages[activeSessionId] || [];
  const sessionRole = getSessionRole(activeSession);
  const isEnded = ['completed', 'aborted', 'error'].includes(activeSession?.status)
    || ['completed', 'aborted', 'error'].includes(activeSession?.phase);

  return (
    <div className="app-main">
      <StatusTag session={activeSession} />
      <MessageList messages={activeMessages} sessionRole={sessionRole} />
      {activeSession && (
        <MessageInput
          sessionId={activeSessionId}
          sessionEndReason={isEnded ? (activeSession.status !== 'active' ? activeSession.status : activeSession.phase) : null}
          send={send}
          onOptimisticMessage={onOptimisticMessage}
        />
      )}
    </div>
  );
}
