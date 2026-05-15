/**
 * Prompt templates — pure functions, no class, no priority sorting.
 * Context derived from EventLog folds + planConfig, not mutable state arrays.
 */

const PHASES = ['authoring', 'confirming', 'reviewing'];

function reviewCriteriaBlock(plan) {
    if (!plan?.review_criteria?.length) return '';
    return plan.review_criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
}

function upstreamBlock(state, node, plan) {
    const upstream = (node.depends_on || [])
        .map((id) => ({ node: state.squad.nodes[id], plan: state.squad.planConfig?.[id] }))
        .filter((x) => x.node)
        .map(({ node: n, plan: p }) => {
            const files = n.affectedFiles?.length ? ` (Files: ${n.affectedFiles.join(', ')})` : '';
            return `- ${n.id}: ${n.summary || ''}${files}`;
        });
    return upstream.length ? upstream.join('\n') : '';
}

function modeWarning(state) {
    if (state.squad.mode === 'M') return '- 你是本次任务的唯一执行者。你必须在本次提交中完成所有闭环。';
    if (state.squad.mode === 'L')
        return '- 你只负责整个系统的一部分（见你的任务描述）。严禁越界修改不属于你职责的核心文件。';
    return '';
}

/**
 * Fold EventLog entries into iterable history for a node.
 * Scans return tool calls, status transitions, and feedback.
 * Groups by epoch (generation of work).
 */
function foldNodeHistory(eventLog, nodeId) {
    const rounds = []; // [{ epoch, workRecord, feedback }, ...]
    const sessions = new Set();

    for (const entry of eventLog.log) {
        const p = entry.payload;
        if (!p) continue;

        // Track sessions belonging to this node
        if ((entry.event === 'session:creating' || entry.event === 'session:start') && p.nodeId === nodeId) {
            sessions.add(p.sessionId);
        }

        // Return tool calls within this node's sessions
        if (entry.event === 'tool_call:started' && p.toolName === 'return' && sessions.has(p.sessionId)) {
            rounds.push({
                epoch: p.epoch ?? p.retryCount ?? 0,
                workRecord: p.params ? { reason: p.params.reason, affected_files: p.params.affected_files } : null,
                feedback: null,
            });
        }
    }

    // Match feedback from squad:node_state (rejection messages) to epochs
    const stateEvents = [];
    for (const entry of eventLog.log) {
        if (entry.event === 'squad:node_state' && entry.payload.nodeId === nodeId && entry.payload.feedback) {
            stateEvents.push(entry.payload);
        }
    }

    // Associate feedback with the closest preceding work record
    for (const se of stateEvents) {
        const targetEpoch = se.epoch ?? se.retryCount ?? 0;
        // Find the round whose epoch matches
        const round = rounds.find((r) => r.epoch === targetEpoch);
        if (round) round.feedback = se.feedback;
    }

    return rounds;
}

function historyBlock(rounds) {
    if (!rounds.length) return '';
    return rounds
        .map((r, i) => {
            const lines = [];
            if (r.workRecord) {
                lines.push(`工作记录 (${i + 1}): ${r.workRecord.reason || ''}`);
                if (r.workRecord.affected_files?.length)
                    lines.push(`  文件: ${r.workRecord.affected_files.join(', ')}`);
            }
            if (r.feedback) lines.push(`审阅者反馈 (${i + 1}): ${r.feedback}`);
            return lines.join('\n');
        })
        .join('\n\n');
}

const TEMPLATES = {
    worker: (state, node, plan, rounds) => {
        const round = rounds.length + 1;
        return `你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。
### 你的任务
${plan.task}

${modeWarning(state)}
${upstreamBlock(state, node, plan) ? `### 上游任务结果\n${upstreamBlock(state, node, plan)}` : ''}
${reviewCriteriaBlock(plan) ? `### 评审标准\n${reviewCriteriaBlock(plan)}` : ''}
${historyBlock(rounds) ? `### Iteration History\n${historyBlock(rounds)}` : ''}
### 状态
现在是第 ${round} 轮，请你继续完善后提交。

### Constraints
- 完成任务后，必须调用 return 工具
- reason: 第 ${round} 轮工作记录
- affected_files: 你创建或修改的每个文件
- 不要用文字表示完成。只有工具调用才算数。`;
    },

    confirming: (state, node, plan, rounds) => {
        return `你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。
### 原始任务
${plan.task}

${reviewCriteriaBlock(plan) ? `### 评审标准\n${reviewCriteriaBlock(plan)}` : ''}
${historyBlock(rounds) ? `### Iteration History\n${historyBlock(rounds)}` : ''}
### Dimensions
- 代码质量 — 是否正确、清晰、符合惯例？
- 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
- 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
- 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

### Instruction
请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })`;
    },

    reviewer: (state, node, plan, rounds) => {
        const currentRound = rounds.length;
        const lastRound = rounds[currentRound - 1] || {};
        const wr = lastRound.workRecord || { reason: 'Initial submission', affected_files: [] };
        const filesBlock = wr.affected_files?.length ? `文件: ${wr.affected_files.join(', ')}` : '（无修改文件）';

        return `你现在是 Squad-Tau 审核专员，负责评审工程师的交付。
### 原始任务
${plan.task}

${reviewCriteriaBlock(plan) ? `### 评审标准\n${reviewCriteriaBlock(plan)}` : ''}
${historyBlock(rounds) ? `### Iteration History\n${historyBlock(rounds)}` : ''}
### Work Record (${currentRound})
- 工作记录 (${currentRound}): ${wr.reason || ''}
- ${filesBlock}

### 审查维度
- 代码质量 — 是否正确、清晰、符合惯例？
- 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
- 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
- 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

### Instruction
评审结束时，必须调用名为 return 的工具提交结果：
- 参数 status: "ok" (通过) 或 "error" (驳回)
- 参数 reason: 详细的修改意见或通过理由
不要用纯文本写 return(...) 的假代码。只有真正的工具调用才有效。`;
    },

    outer_review: (state) => {
        const results = Object.values(state.squad.nodes)
            .map((n) => {
                const p = state.squad.planConfig?.[n.id];
                if (p?.resetOnRej) return null; // skip __or__
                const files = n.affectedFiles?.length ? `, 文件: ${n.affectedFiles.join(', ')}` : '';
                return `- ${n.id} (${n.status}): ${n.summary || ''}${files}`;
            })
            .filter(Boolean);

        return `你现在是 Squad-Tau 最终审核者，负责评审多节点协作的聚合结果。
### 原始任务
${state.squad.originalTask}

### 节点结果
${results.join('\n') || '（无节点）'}

### Instruction
聚合结果是否满足原始任务？
- 满足：return({ status: "ok", reason: "..." })
- 不满足：return({ status: "error", reason: "..." }) 附详细修改意见`;
    },
};

export function buildPrompt(phase, state, node, eventLog) {
    const plan = state.squad.planConfig?.[node.id] || {};
    const templateKey =
        phase === 'outer_review'
            ? 'outer_review'
            : phase === 'confirming'
              ? 'confirming'
              : phase === 'reviewing'
                ? 'reviewer'
                : 'worker';

    const rounds = eventLog ? foldNodeHistory(eventLog, node.id) : [];
    return TEMPLATES[templateKey]?.(state, node, plan, rounds) || '';
}
