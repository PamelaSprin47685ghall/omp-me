import { useReducer } from 'react';

function createInitialState() {
    return {
        squad: null,
        nodes: new Map(),
        results: null,
        outerReview: null,
    };
}

function squadReducer(state, action) {
    switch (action.type) {
        case 'SQUAD_INIT': {
            const { mode, nodes, originalTask } = action.payload;
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

        case 'NODE_STATE': {
            const { nodeId, status, retryCount, summary, affectedFiles } = action.payload;
            const updatedNodes = new Map(state.nodes);
            const existing = updatedNodes.get(nodeId);
            if (existing) {
                updatedNodes.set(nodeId, {
                    ...existing,
                    status,
                    retryCount,
                    summary,
                    affectedFiles,
                });
            }
            return { ...state, nodes: updatedNodes };
        }

        case 'SQUAD_COMPLETE': {
            const { results } = action.payload;
            return { ...state, results };
        }

        case 'OUTER_REVIEW_START': {
            const { round } = action.payload;
            return {
                ...state,
                outerReview: { round, verdict: null, feedback: null },
            };
        }

        case 'OUTER_REVIEW_RESULT': {
            const { round, verdict, feedback } = action.payload;
            return {
                ...state,
                outerReview: { round, verdict, feedback },
            };
        }

        case 'SQUAD_ABORT': {
            return {
                squad: null,
                nodes: new Map(),
                results: null,
                outerReview: null,
            };
        }

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
