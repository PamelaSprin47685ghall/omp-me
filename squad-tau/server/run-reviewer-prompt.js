import { formatReviewCriteria, buildIterationHistory } from './prompt-utils.js';

export function buildReviewerPrompt({ node, workerResult, iterationHistory }) {
    const sections = ['你现在是 Squad-Tau 审核专员，负责评审工程师的交付。'];

    sections.push(`\n原始任务: ${node.task}`);

    const criteriaText = formatReviewCriteria(node.review_criteria);
    if (criteriaText) {
        sections.push(`\n评审标准:\n${criteriaText}`);
    }

    const historyText = buildIterationHistory(iterationHistory);
    if (historyText) {
        sections.push(`\n${historyText}`);
    }

    const currentRound = (iterationHistory?.length || 0) + 1;
    sections.push(`\n工作记录 (${currentRound}): ${workerResult.reason || ''}`);
    if (workerResult.affected_files?.length > 0) {
        sections.push(`  文件: ${workerResult.affected_files.join(', ')}`);
    }

    sections.push(
        `\n本次提交的修改文件列表:\n${(workerResult.affected_files || []).map((f) => `  - ${f}`).join('\n')}`,
    );

    sections.push(`\n请你撰写审阅者反馈 (${currentRound})。`);

    sections.push(
        '\n审查维度:',
        '1. 代码质量 — 是否正确、清晰、符合惯例？',
        '2. 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？',
        '3. 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？',
        '4. 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？',
    );

    sections.push(
        '\n---',
        '评审结束时，必须调用名为 return 的工具提交结果：',
        '- 参数 status: "ok" (通过) 或 "error" (驳回)',
        '- 参数 reason: 详细的修改意见或通过理由',
        '',
        '不要用纯文本写 return(...) 的假代码。只有真正的工具调用才有效。',
    );

    return sections.join('\n');
}
