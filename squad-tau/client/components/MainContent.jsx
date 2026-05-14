import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Button, Callout, Tag } from '@blueprintjs/core';
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
    <div className="bp6-text-small bp6-text-muted" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {nodeId && <Tag minimal>Node: {nodeId}</Tag>}
      {retryCount > 0 && <Tag minimal intent="warning">Retry #{retryCount}</Tag>}
      <Tag minimal>{phase}</Tag>
      <Tag minimal>{status}</Tag>
    </div>
  );
}

function FailedBanner({ nodes, onDismiss }) {
  const failed = useMemo(() => Array.from(nodes.values()).filter((node) => node.status === 'failed' || node.status === 'blocked'), [nodes]);
  const failedCount = failed.filter((node) => node.status === 'failed').length;
  const blockedCount = failed.filter((node) => node.status === 'blocked').length;
  const reason = failed.find((node) => node.summary)?.summary || 'Unknown error';
  if (!failed.length) return null;
  return (
    <Callout
      intent="danger"
      icon={IconNames.ERROR}
      title={`Squad Failed — ${failedCount} failed, ${blockedCount} blocked`}
      action={<Button minimal small text="Dismiss" onClick={onDismiss} />}
    >
      {reason}
    </Callout>
  );
}

function SuccessBanner({ results }) {
  if (!results?.length) return null;
  if (results.some((result) => result.status !== 'approved')) return null;
  return (
    <Callout intent="success" icon={IconNames.TICK_CIRCLE}>
      Squad completed successfully
    </Callout>
  );
}

export default function MainContent({
  viewMode, squadActive, nodes, activeSessionId, sessions, messages,
  onNodeClick, onOpenModelPool, onOptimisticMessage, send, results,
}) {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const prevSquadActive = useRef(squadActive);

  useEffect(() => {
    if (squadActive && !prevSquadActive.current) setBannerDismissed(false);
    prevSquadActive.current = squadActive;
  }, [squadActive]);

  if (!squadActive) return <WelcomeView onOpenModelPool={onOpenModelPool} />;

  if (viewMode === 'dag') {
    return (
      <div className="bp6-fill bp6-padding">
        {!bannerDismissed && <FailedBanner nodes={nodes} onDismiss={() => setBannerDismissed(true)} />}
        <SuccessBanner results={results} />
        <DAGView nodes={Array.from(nodes.values())} activeNodeId={null} onNodeClick={onNodeClick} />
      </div>
    );
  }

  const activeSession = [...sessions.values()].find((session) => session.sessionId === activeSessionId);
  const activeMessages = messages.get(activeSessionId) || [];
  const sessionRole = getSessionRole(activeSession);

  return (
    <div className="bp6-fill bp6-padding" style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <StatusTag session={activeSession} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <MessageList messages={activeMessages} sessionRole={sessionRole} />
      </div>
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
