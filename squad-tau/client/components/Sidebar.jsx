import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Tree, Icon, Button, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

function statusIcon(status) {
  switch (status) {
    case 'approved': return IconNames.TICK_CIRCLE;
    case 'rejected': return IconNames.CROSS_CIRCLE;
    case 'pending': return IconNames.TIME;
    case 'active':
    case 'authoring':
    case 'confirming':
    case 'reviewing': return IconNames.REFRESH;
    case 'failed':
    case 'blocked': return IconNames.BAN_CIRCLE;
    default: return IconNames.CIRCLE;
  }
}

function statusIntent(status) {
  switch (status) {
    case 'approved': return 'success';
    case 'rejected':
    case 'failed':
    case 'blocked': return 'danger';
    case 'active':
    case 'authoring':
    case 'confirming':
    case 'reviewing': return 'warning';
    default: return 'none';
  }
}

function buildTree(sessions, nodes, viewMode) {
  const dagNode = {
    id: '__dag__',
    label: 'DAG Overview',
    icon: <Icon icon={IconNames.GRAPH} size={14} />,
    isSelected: viewMode === 'dag',
    nodeData: { isDag: true },
  };

  const nodeMap = new Map();
  const topLevel = [];

  sessions.forEach(session => {
    const { sessionId, nodeId, phase, retryCount, status } = session;
    if (!nodeId) {
      topLevel.push({
        id: sessionId,
        label: phase === 'outer_review' ? 'Outer Review' : 'Architect',
        icon: <Icon icon={statusIcon(status)} intent={statusIntent(status)} size={14} />,
        nodeData: { sessionId },
      });
      return;
    }
    if (!nodeMap.has(nodeId)) {
      const info = nodes.get(nodeId);
      nodeMap.set(nodeId, {
        id: nodeId,
        label: nodeId,
        icon: <Icon icon={statusIcon(info?.status)} intent={statusIntent(info?.status)} size={14} />,
        isExpanded: true,
        childNodes: [],
      });
    }
    nodeMap.get(nodeId).childNodes.push({
      id: sessionId,
      label: `R${(retryCount ?? 0) + 1} ${phase}`,
      icon: <Icon icon={statusIcon(status)} intent={statusIntent(status)} size={12} />,
      nodeData: { sessionId },
    });
  });

  return [dagNode, ...Array.from(nodeMap.values()), ...topLevel];
}

export default function Sidebar({ sessions, nodes, activeSessionId, onSelectSession, viewMode, onSelectDAG }) {
  const [locked, setLocked] = useState(false);
  const treeNodes = useMemo(() => buildTree(sessions, nodes, viewMode), [sessions, nodes, viewMode]);

  useEffect(() => {
    if (!locked && sessions.length > 0) {
      const latest = sessions[sessions.length - 1];
      if (latest.sessionId !== activeSessionId) onSelectSession(latest.sessionId);
    }
  }, [sessions, locked, activeSessionId, onSelectSession]);

  const handleNodeClick = useCallback((node) => {
    if (node.nodeData?.isDag) { onSelectDAG(); return; }
    const sid = node.nodeData?.sessionId;
    if (sid) { onSelectSession(sid); setLocked(true); }
  }, [onSelectSession, onSelectDAG]);

  return (
    <div className="app-sidebar">
      <div className="sidebar-header-row">
        <span className="sidebar-title">Sessions</span>
        {locked && (
          <Tooltip content="Unlock auto-follow" minimal>
            <Button minimal small icon={IconNames.LOCK} onClick={() => setLocked(false)} />
          </Tooltip>
        )}
      </div>
      <Tree contents={treeNodes} onNodeClick={handleNodeClick} />
    </div>
  );
}
