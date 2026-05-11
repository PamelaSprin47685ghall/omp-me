function formatReviewCriteria(criteria) {
    if (!criteria) return '';
    if (typeof criteria === 'string') return criteria;
    if (Array.isArray(criteria)) {
        if (criteria.length === 0) return '';
        if (typeof criteria[0] === 'string') return criteria.join('\n');
        return criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
    }
    return '';
}

function buildUpstreamSection(upstreamResults) {
    if (!upstreamResults || upstreamResults.length === 0) return '';
    const lines = upstreamResults.map((u) => {
        const files = (u.affectedFiles || []).length > 0 ? `, 文件: ${(u.affectedFiles || []).join(', ')}` : '';
        return `- ${u.nodeId || u.id}: ${u.summary}${files}`;
    });
    return `上游任务结果:\n${lines.join('\n')}`;
}

function buildIterationHistory(history) {
    if (!history || history.length === 0) return '';
    const lines = [];
    for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        lines.push(`工作记录 (${i + 1}): ${entry.workRecord?.reason || ''}`);
        if (entry.workRecord?.affected_files?.length > 0) {
            lines.push(`  文件: ${entry.workRecord.affected_files.join(', ')}`);
        }
        lines.push(`审阅者反馈 (${i + 1}): ${entry.feedback || ''}`);
    }
    return lines.join('\n');
}

function buildWorkerPrompt(node, upstreamResults, iterationHistory) {
    const sections = ['你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。'];

    sections.push(`\n你的任务: ${node.task}`);

    const criteriaText = formatReviewCriteria(node.review_criteria);
    if (criteriaText) {
        sections.push(`\n评审标准:\n${criteriaText}`);
    }

    const upstreamText = buildUpstreamSection(upstreamResults);
    if (upstreamText) {
        sections.push(`\n${upstreamText}`);
    }

    const historyText = buildIterationHistory(iterationHistory);
    if (historyText) {
        sections.push(`\n${historyText}`);
    }

    const round = (iterationHistory?.length || 0) + 1;
    sections.push(`\n现在是第 ${round} 轮，请你继续完善后提交。`);

    sections.push(
        '\n---',
        '完成任务后，必须调用 return 工具：',
        '- status: "ok"',
        `- reason: 第 ${round} 轮工作记录`,
        '- affected_files: 你创建或修改的每个文件',
        '',
        '不要用文字表示完成。只有工具调用才算数。',
    );

    return sections.join('\n');
}

function buildConfirmPrompt(node) {
    const task = typeof node === 'string' ? node : node.task;
    const criteria = node?.review_criteria || [];

    let criteriaSection = '';
    if (criteria.length > 0) {
        criteriaSection = '\n' + criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
    }

    return `你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。

原始任务: ${task}
评审标准:${criteriaSection}

审查维度:
1. 代码质量 — 是否正确、清晰、符合惯例？
2. 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
3. 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
4. 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

- 请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })`;
}

export { buildWorkerPrompt, buildConfirmPrompt };
