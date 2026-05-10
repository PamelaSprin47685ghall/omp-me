import { createLifecycleTool } from './lifecycle-tools.js';

const APPROVE_SPEC = {
    name: 'approve',
    label: 'Approve Work',
    desc: 'Approve the submitted work after review.',
    props: {
        comment: { type: 'string', description: 'Optional approval comment' },
    },
    required: [],
};

const REJECT_SPEC = {
    name: 'reject',
    label: 'Reject Work',
    desc: 'Reject the submitted work and provide feedback for revision.',
    props: {
        feedback: { type: 'string', description: 'Detailed feedback explaining what needs to be fixed' },
    },
    required: ['feedback'],
};

function buildReviewerTools(outcomeResolve, setSettled) {
    const approveTool = createLifecycleTool(APPROVE_SPEC, (params) => {
        setSettled(true);
        outcomeResolve({ approved: true, comment: params.comment });
    });

    const rejectTool = createLifecycleTool(REJECT_SPEC, (params) => {
        setSettled(true);
        outcomeResolve({ approved: false, feedback: params.feedback });
    });

    return [approveTool, rejectTool];
}

export { buildReviewerTools };
