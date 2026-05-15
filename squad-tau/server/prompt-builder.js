/**
 * Prompt templates — pure functions, no class, no priority sorting.
 * Sections composed via functional piping.
 */

function reviewCriteriaBlock(node) {
    if (!node.review_criteria?.length) return '';
    return node.review_criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
}

function historyBlock(node) {
    const h = node.history || [];
    if (!h.length) return '';
    return h
        .map((entry, i) => {
            const lines = [`工作记录 (${i + 1}): ${entry.workRecord?.reason || ''}`];
            if (entry.workRecord?.affected_files?.length)
                lines.push(`  文件: ${entry.workRecord.affected_files.join(', ')}`);
            lines.push(`审阅者反馈 (${i + 1}): ${entry.feedback || ''}`);
            return lines.join('\n');
        })
        .join('\n\n');
}

function modeWarning(state) {
    if (state.squad.mode === 'M') return '- 你是本次任务的唯一执行者。你必须在本次提交中完成所有闭环。';
    if (state.squad.mode === 'L')
        return '- 你只负责整个系统的一部分（见你的任务描述）。严禁越界修改不属于你职责的核心文件。';
    return '';
}

function upstreamBlock(state, node) {
    const upstream = (node.depends_on || [])
        .map((id) => state.squad.nodes[id])
        .filter(Boolean)
        .map((n) => {
            const files = n.affectedFiles?.length ? ` (Files: ${n.affectedFiles.join(', ')})` : '';
            return `- ${n.id}: ${n.summary || ''}${files}`;
        });
    return upstream.length ? upstream.join('\n') : '';
}

function roundNumber(node) {
    return (node.history?.length || 0) + 1;
}

const TEMPLATES = {
    worker: (state, node) => {
        const round = roundNumber(node);
        return `你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。
### 你的任务
${node.task}

${modeWarning(state)}
${upstreamBlock(state, node) ? `### 上游任务结果\n${upstreamBlock(state, node)}` : ''}
${reviewCriteriaBlock(node) ? `### 评审标准\n${reviewCriteriaBlock(node)}` : ''}
${historyBlock(node) ? `### Iteration History\n${historyBlock(node)}` : ''}
### 状态
现在是第 ${round} 轮，请你继续完善后提交。

### Constraints
- 完成任务后，必须调用 return 工具
- reason: 第 ${round} 轮工作记录
- affected_files: 你创建或修改的每个文件
- 不要用文字表示完成。只有工具调用才算数。`;
    },

    confirming: (state, node) => {
        const task = typeof node === 'string' ? node : node.task;
        return `你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。
### 原始任务
${task}

${reviewCriteriaBlock(node) ? `### 评审标准\n${reviewCriteriaBlock(node)}` : ''}
${historyBlock(node) ? `### Iteration History\n${historyBlock(node)}` : ''}
### Dimensions
- 代码质量 — 是否正确、清晰、符合惯例？
- 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
- 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
- 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

### Instruction
请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })`;
    },

    reviewer: (state, node) => {
        const currentRound = roundNumber(node);
        const workerSession = Object.values(state.sessions).find(
            (s) => s.nodeId === node.id && s.role === 'worker_confirm',
        );
        const workerReturn = workerSession?.latestReturn || {
            status: 'ok',
            reason: 'Initial submission',
            affected_files: [],
        };
        const filesBlock = workerReturn.affected_files?.length
            ? `文件: ${workerReturn.affected_files.join(', ')}`
            : '（无修改文件）';

        return `你现在是 Squad-Tau 审核专员，负责评审工程师的交付。
### 原始任务
${node.task}

${reviewCriteriaBlock(node) ? `### 评审标准\n${reviewCriteriaBlock(node)}` : ''}
${historyBlock(node) ? `### Iteration History\n${historyBlock(node)}` : ''}
### Work Record (${currentRound})
- 工作记录 (${currentRound}): ${workerReturn.reason || ''}
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

    outer_review: (state, _node) => {
        const results = Object.values(state.squad.nodes)
            .filter((n) => !n.resetDependentsOnRejection)
            .map((n) => {
                const files = n.affectedFiles?.length ? `, 文件: ${n.affectedFiles.join(', ')}` : '';
                return `- ${n.id} (${n.status}): ${n.summary || ''}${files}`;
            });

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

export function buildPrompt(phase, state, node) {
    const template =
        phase === 'outer_review'
            ? 'outer_review'
            : phase === 'confirming'
              ? 'confirming'
              : phase === 'reviewing'
                ? 'reviewer'
                : 'worker';
    return TEMPLATES[template]?.(state, node) || '';
}
