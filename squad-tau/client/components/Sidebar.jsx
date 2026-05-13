import React, { useMemo, useCallback } from 'react';
import { Tree, Icon } from '@blueprintjs/core';
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

function buildTree(sessions, nodes, viewMode, activeSessionId) {
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
        isSelected: activeSessionId === sessionId,
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
      isSelected: activeSessionId === sessionId,
      nodeData: { sessionId },
    });
  });

  return [dagNode, ...Array.from(nodeMap.values()), ...topLevel];
}

export default function Sidebar({ sessions, nodes, activeSessionId, onSelectSession, viewMode, onSelectDAG }) {
  const treeNodes = useMemo(() => buildTree(sessions, nodes, viewMode, activeSessionId), [sessions, nodes, viewMode, activeSessionId]);

  const handleNodeClick = useCallback((node) => {
    if (node.nodeData?.isDag) { onSelectDAG(); return; }
    const sid = node.nodeData?.sessionId;
    if (sid) { onSelectSession(sid); }
  }, [onSelectSession, onSelectDAG]);

  return (
    <div className="app-sidebar">
      <span className="sidebar-title">Sessions</span>
      <Tree contents={treeNodes} onNodeClick={handleNodeClick} />
    </div>
  );
}
