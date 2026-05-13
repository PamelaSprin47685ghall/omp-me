import { useReducer } from 'react';

function createInitialState() {
    return {
        squad: null,
        nodes: new Map(),
        results: null,
        outerReview: null,
    };
}

function handleSquadInit(state, payload) {
    const { mode, nodes, originalTask } = payload;
    const nodeMap = new Map();
    nodes.forEach((node) => {
        nodeMap.set(node.id, {
            ...node,
            status: node.depends_on?.length ? 'waiting_deps' : 'pending',
            retryCount: 0,
        });
    });
    return {
        ...state,
        squad: { mode, originalTask },
        nodes: nodeMap,
        results: null,
        outerReview: null,
    };
}

function handleNodeState(state, payload) {
    const { nodeId, status, retryCount, summary, affectedFiles } = payload;
    const updatedNodes = new Map(state.nodes);
    const existing = updatedNodes.get(nodeId);
    if (existing) {
        updatedNodes.set(nodeId, {
            ...existing,
            status,
            ...(retryCount !== undefined && { retryCount }),
            summary: summary ?? existing.summary,
            affectedFiles: affectedFiles ?? existing.affectedFiles,
        });
    }
    return { ...state, nodes: updatedNodes };
}

function handleOuterReview(state, action) {
    if (action.type === 'SQUAD_OUTER_REVIEW_START') {
        return {
            ...state,
            outerReview: { round: action.payload.round, verdict: null, feedback: null },
        };
    }
    const { round, verdict, feedback } = action.payload;
    return {
        ...state,
        outerReview: { round, verdict, feedback },
    };
}

function squadReducer(state, action) {
    switch (action.type) {
        case 'SQUAD_INIT':
            return handleSquadInit(state, action.payload);
        case 'NODE_STATE':
            return handleNodeState(state, action.payload);
        case 'SQUAD_COMPLETE':
            return { ...state, results: action.payload.results };
        case 'SQUAD_OUTER_REVIEW_START':
        case 'SQUAD_OUTER_REVIEW_RESULT':
            return handleOuterReview(state, action);
        case 'SQUAD_ABORT':
            return createInitialState();
        default:
            return state;
    }
}

export default function useSquadState() {
    const [state, dispatch] = useReducer(squadReducer, null, createInitialState);
    return {
        squad: state.squad,
        nodes: state.nodes,
        results: state.results,
        outerReview: state.outerReview,
        dispatch,
    };
}
