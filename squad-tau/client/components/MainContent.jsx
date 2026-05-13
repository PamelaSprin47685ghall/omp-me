import React, { useState, useMemo } from 'react';
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

function FailedBanner({ nodes, onDismiss }) {
  const failed = useMemo(() =>
    Array.from(nodes.values()).filter(n => n.status === 'failed' || n.status === 'blocked'),
  [nodes]);
  const failedCount = failed.filter(n => n.status === 'failed').length;
  const blockedCount = failed.filter(n => n.status === 'blocked').length;
  const reason = failed.find(n => n.summary)?.summary || 'Unknown error';
  if (!failed.length) return null;
  return (
    <Callout intent="danger" icon={IconNames.ERROR} className="banner"
      title={`Squad Failed — ${failedCount} failed, ${blockedCount} blocked`}>
      {reason}
      <div style={{ cursor: 'pointer', textAlign: 'right', marginTop: 4 }} onClick={onDismiss}>Dismiss</div>
    </Callout>
  );
}

function SuccessBanner({ results }) {
  if (!results?.length) return null;
  const hasFailed = results.some(r => r.status !== 'approved');
  if (hasFailed) return null;
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
  const [bannerDismissed, setBannerDismissed] = useState(false);
  if (!squadActive) return <WelcomeView onOpenModelPool={onOpenModelPool} />;

  if (viewMode === 'dag') {
    return (
      <div className="app-main">
        {!bannerDismissed && <FailedBanner nodes={nodes} onDismiss={() => setBannerDismissed(true)} />}
        <SuccessBanner results={results} />
        <DAGView nodes={Array.from(nodes.values())} activeNodeId={null} onNodeClick={onNodeClick} />
      </div>
    );
  }

  const activeSession = [...sessions.values()].find(s => s.sessionId === activeSessionId);
  const activeMessages = messages.get(activeSessionId) || [];
  const sessionRole = getSessionRole(activeSession);

  return (
    <div className="app-main">
      <StatusTag session={activeSession} />
      <MessageList messages={activeMessages} sessionRole={sessionRole} />
      {activeSession && (
        <MessageInput
          sessionId={activeSessionId}
          send={send}
          onOptimisticMessage={onOptimisticMessage}
        />
      )}
    </div>
  );
}
