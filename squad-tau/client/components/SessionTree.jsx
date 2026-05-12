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
    if (!current?.childNodes) return null;
    current = current.childNodes[path[i]];
  }
  return current;
}

function useTreeHandlers(nodes, activeSessionId, onNodeClick) {
  const [contents, setContents] = useState(() => 
    nodes.map(n => enrichNode(n, activeSessionId))
  );
  
  // Merge new node data while preserving expansion state
  React.useEffect(() => {
    setContents(prev => {
      const prevExpanded = new Map();
      const walk = (list) => {
        list.forEach(n => {
          prevExpanded.set(n.id, n.isExpanded);
          if (n.childNodes) walk(n.childNodes);
        });
      };
      walk(prev);

      const merge = (list) => list.map(n => ({
        ...n,
        isExpanded: prevExpanded.has(n.id) ? prevExpanded.get(n.id) : n.isExpanded,
        childNodes: n.childNodes ? merge(n.childNodes) : n.childNodes,
      }));

      return merge(nodes.map(n => enrichNode(n, activeSessionId)));
    });
  }, [nodes, activeSessionId]);
  
  const handleNodeClick = useCallback((nodeData, nodePath) => {
    const node = getNodeAtPath(contents, nodePath);
    if (node?.sessionId) onNodeClick(node.sessionId);
  }, [contents, onNodeClick]);
  
  const updateNodeAt = (nodes, path, isExpanded) => {
    return nodes.map((node, i) => {
      if (i !== path[0]) return node;
      if (path.length === 1) return { ...node, isExpanded };
      return {
        ...node,
        childNodes: updateNodeAt(node.childNodes || [], path.slice(1), isExpanded)
      };
    });
  };

  const updateNode = useCallback((nodePath, isExpanded) => {
    setContents(curr => updateNodeAt(curr, nodePath, isExpanded));
  }, []);

  return {
    contents,
    handleNodeClick,
    handleNodeCollapse: (d, p) => updateNode(p, false),
    handleNodeExpand: (d, p) => updateNode(p, true)
  };
}

export default function SessionTree({ nodes, activeSessionId, onNodeClick }) {
  const {
    contents,
    handleNodeClick,
    handleNodeCollapse,
    handleNodeExpand
  } = useTreeHandlers(nodes, activeSessionId, onNodeClick);
  
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
