/**
 * @fileoverview JSDoc type definitions for event protocol and component props.
 * Zero runtime code — pure JSDoc comments only.
 */

/** @typedef {{type:string, payload:*, timestamp:number}} WebSocketMessage */

/** @typedef {{}} Ping */

/** @typedef {{}} Pong */

/** @typedef {Object} NodeInfo
 * @property {string} id
 * @property {string} task
 * @property {string|string[]} review_criteria
 * @property {string[]} [depends_on] */

/** @typedef {Object} SquadInit
 * @property {'M'|'L'} mode
 * @property {NodeInfo[]} nodes
 * @property {string} originalTask */

/** @typedef {Object} NodeState
 * @property {string} nodeId
 * @property {'waiting_deps'|'pending'|'authoring'|'confirming'|'reviewing'|'approved'|'rejected'|'blocked'|'failed'} status
 * @property {number} retryCount
 * @property {string} [summary]
 * @property {string[]} [affectedFiles] */

/** @typedef {Object} SquadComplete
 * @property {{id:string, status:string, summary:string, affectedFiles:string[]}[]} results
 * @property {number} durationMs */

/** @typedef {{reason?:string}} SquadAbort */

/** @typedef {{round:number}} OuterReviewStart */

/** @typedef {Object} OuterReviewResult
 * @property {number} round
 * @property {'approved'|'rejected'} verdict
 * @property {string} [feedback] */

/** @typedef {{sessionId:number, serverVersion:string}} ConnectionEstablished */

/** @typedef {{reason:string}} ConnectionClose */

/** @typedef {Object} SessionStart
 * @property {string} sessionId
 * @property {string} [nodeId]
 * @property {'worker'|'reviewer'|'outer_review'|'main'} phase
 * @property {number} [retryCount]
 * @property {{provider:string, id:string}} [model] */

/** @typedef {Object} SessionState
 * @property {string} sessionId
 * @property {'authoring'|'confirming'|'reviewing'|'completed'|'aborted'} phase */

/** @typedef {Object} SessionMessage
 * @property {string} sessionId
 * @property {'user'|'assistant'} role
 * @property {Object[]} content
 * @property {string} messageId
 * @property {string} [parentId] */

/** @typedef {Object} SessionMessageDelta
 * @property {string} sessionId
 * @property {string} messageId
 * @property {{type:'text_delta'|'thinking_delta', text:string}} delta */

/** @typedef {Object} SessionToolCall
 * @property {string} sessionId
 * @property {string} toolName
 * @property {string} toolId
 * @property {*} params */

/** @typedef {Object} SessionToolResult
 * @property {string} sessionId
 * @property {string} toolId
 * @property {*} result
 * @property {boolean} isError */

/** @typedef {Object} SessionEnd
 * @property {string} sessionId
 * @property {'completed'|'aborted'|'error'} reason
 * @property {string} [errorMessage] */

/** @typedef {Object} SessionUserMessage
 * @property {string} sessionId
 * @property {string} text */

/** @typedef {Object} ModelSlot
 * @property {string} provider
 * @property {string} modelId
 * @property {'worker'|'reviewer'} role
 * @property {string} [thinkingLevel]
 * @property {boolean} inUse */

/** @typedef {{slots:ModelSlot[]}} ModelPoolSnapshot */

/** @typedef {{slots:ModelSlot[]}} ModelPoolChanged */

/** @typedef {Object} ModelPoolUpdate
 * @property {'add'|'remove'|'edit'} action
 * @property {ModelSlot} [slot]
 * @property {number} [index] */

/** @typedef {Object} SessionInfo
 * @property {string} sessionId
 * @property {string} [nodeId]
 * @property {string} phase */

/** @typedef {Object} HeaderProps
 * @property {string} title
 * @property {boolean} [connected]
 * @property {()=>void} [onPing] */

/** @typedef {Object} SidebarProps
 * @property {{sessionId:string, nodeId?:string, status:string}[]} sessions
 * @property {string} activeSessionId
 * @property {(id:string)=>void} onSelectSession
 * @property {'dag'|'session'} viewMode
 * @property {()=>void} onSelectDAG */

/** @typedef {Object} DAGViewProps
 * @property {{id:string, status:string, depends_on?:string[]}[]} nodes
 * @property {string} [activeNodeId]
 * @property {(id:string)=>void} [onNodeClick]
 * @property {boolean} [collapsed]
 * @property {()=>void} [onToggle] */

/** @typedef {Object} MessageListProps
 * @property {SessionMessage[]} messages
 * @property {SessionMessageDelta[]} [deltas]
 * @property {SessionToolCall[]} [toolCalls]
 * @property {SessionToolResult[]} [toolResults] */

/** @typedef {Object} MessageInputProps
 * @property {string|null} sessionId
 * @property {(message: {type: string, payload: object}) => void} send
 * @property {(msg: {messageId: string, sessionId: string, role: string, content: *}) => void} onOptimisticMessage */

/** @typedef {Object} ModelPoolDrawerProps
 * @property {boolean} isOpen
 * @property {ModelSlot[]} slots
 * @property {(action:string, slot?:ModelSlot, index?:number)=>void} onUpdateSlot
 * @property {()=>void} onClose */
