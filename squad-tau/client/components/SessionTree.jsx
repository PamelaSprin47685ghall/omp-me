import React, { useState, useCallback } from 'react';
import { Tree } from '@blueprintjs/core';

const TREE_STYLE = {
  padding: 0
};

const NODE_STYLE = {
  cursor: 'pointer'
};

const ACTIVE_NODE_STYLE = {
  backgroundColor: 'rgba(19, 124, 189, 0.2)',
  fontWeight: 'bold'
};

function enrichNode(node, activeSessionId) {
  const isActive = node.sessionId === activeSessionId;
  const style = isActive ? { ...NODE_STYLE, ...ACTIVE_NODE_STYLE } : NODE_STYLE;
  
  return {
    ...node,
    nodeData: { style },
    hasCaret: node.childNodes && node.childNodes.length > 0,
    childNodes: node.childNodes?.map(child => 
      enrichNode(child, activeSessionId)
    )
  };
}

function getNodeAtPath(nodes, path) {
  let current = nodes[path[0]];
  for (let i = 1; i < path.length; i++) {
    current = current.childNodes[path[i]];
  }
  return current;
}

export default function SessionTree({ nodes, activeSessionId, onNodeClick }) {
  const [contents, setContents] = useState(() => 
    nodes.map(n => enrichNode(n, activeSessionId))
  );
  
  React.useEffect(() => {
    setContents(nodes.map(n => enrichNode(n, activeSessionId)));
  }, [nodes, activeSessionId]);
  
  const handleNodeClick = useCallback((nodeData, nodePath) => {
    const node = getNodeAtPath(contents, nodePath);
    if (node.sessionId) {
      onNodeClick(node.sessionId);
    }
  }, [contents, onNodeClick]);
  
  const handleNodeCollapse = useCallback((nodeData, nodePath) => {
    setContents(curr => {
      const updated = [...curr];
      const node = getNodeAtPath(updated, nodePath);
      if (node) node.isExpanded = false;
      return updated;
    });
  }, []);
  
  const handleNodeExpand = useCallback((nodeData, nodePath) => {
    setContents(curr => {
      const updated = [...curr];
      const node = getNodeAtPath(updated, nodePath);
      if (node) node.isExpanded = true;
      return updated;
    });
  }, []);
  
  return (
    <Tree
      contents={contents}
      onNodeClick={handleNodeClick}
      onNodeCollapse={handleNodeCollapse}
      onNodeExpand={handleNodeExpand}
      style={TREE_STYLE}
    />
  );
}
