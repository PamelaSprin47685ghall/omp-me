import { PromptDoc } from './prompt-builder.js';

function formatReviewCriteria(criteria) {
    if (!criteria) return null;
    if (typeof criteria === 'string') return criteria;
    if (Array.isArray(criteria)) {
        if (criteria.length === 0) return null;
        if (typeof criteria[0] === 'object' && criteria[0] !== null) {
            return criteria.map((c) => `${c.name}: ${c.description}`);
        }
        return criteria;
    }
    return String(criteria);
}

function buildIterationHistory(history) {
    if (!history || history.length === 0) return null;
    return history.map((entry, i) => {
        const lines = [`工作记录 (${i + 1}): ${entry.workRecord?.reason || ''}`];
        if (entry.workRecord?.affected_files?.length > 0) {
            lines.push(`  文件: ${entry.workRecord.affected_files.join(', ')}`);
        }
        lines.push(`审阅者反馈 (${i + 1}): ${entry.feedback || ''}`);
        return lines.join('\n');
    });
}

export function buildReviewerPrompt({ node, workerResult, iterationHistory }) {
    const currentRound = (iterationHistory?.length || 0) + 1;
    const doc = new PromptDoc();

    doc.addSection('Role', '你现在是 Squad-Tau 审核专员，负责评审工程师的交付。', 100);
    doc.addSection('原始任务:', node.task, 100);

    const criteria = node.review_criteria?.length ? formatReviewCriteria(node.review_criteria) : null;
    if (criteria) {
        doc.addSection('评审标准:', criteria, 80);
    }

    const history = buildIterationHistory(iterationHistory);
    if (history) {
        doc.addSection('Iteration History', history, 50);
    }

    const workerFields = [
        {
            title: `工作记录 (${currentRound})`,
            content: workerResult.reason || '',
        },
    ];
    if (workerResult.affected_files?.length) {
        workerFields.push({
            title: '文件',
            content: workerResult.affected_files.join(', '),
        });
    }
    doc.addSection(
        `Work Record (${currentRound})`,
        workerFields.map((f) => `${f.title}: ${f.content}`),
        90,
    );

    const affectedFiles = (workerResult.affected_files || []).map((f) => `  - ${f}`).join('\n');
    doc.addSection('本次提交的修改文件列表:', affectedFiles || '（无）', 80);

    doc.addSection(
        '审查维度:',
        [
            '代码质量 — 是否正确、清晰、符合惯例？',
            '设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？',
            '用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？',
            '目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？',
        ],
        100,
    );

    doc.addSection(
        'Instruction',
        [
            '评审结束时，必须调用名为 return 的工具提交结果：',
            '- 参数 status: "ok" (通过) 或 "error" (驳回)',
            '- 参数 reason: 详细的修改意见或通过理由',
            '不要用纯文本写 return(...) 的假代码。只有真正的工具调用才有效。',
        ],
        100,
    );

    return doc.compile();
}
