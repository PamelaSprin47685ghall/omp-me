import { PromptDoc } from './prompt-builder.js';

function buildWorkerPrompt(node, upstreamResults, iterationHistory) {
    const round = (iterationHistory?.length || 0) + 1;
    const doc = new PromptDoc();

    doc.addSection('Role', '你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。', 100);
    doc.addSection('你的任务:', node.task, 100);

    if (node.review_criteria?.length) {
        doc.addSection(
            '评审标准:',
            node.review_criteria.map((c) => `${c.name}: ${c.description}`),
            80,
        );
    }

    if (upstreamResults?.length) {
        doc.addSection(
            '上游任务结果:',
            upstreamResults.map((u) => {
                const files = u.affectedFiles?.length ? ` (Files: ${u.affectedFiles.join(', ')})` : '';
                return `${u.nodeId || u.id}: ${u.summary}${files}`;
            }),
            60,
        );
    }

    if (iterationHistory?.length) {
        doc.addSection(
            'Iteration History',
            iterationHistory.map(
                (h, i) => `工作记录 (${i + 1}): ${h.workRecord.reason}\n审阅者反馈 (${i + 1}): ${h.feedback}`,
            ),
            50,
        );
    }

    doc.addSection('Status', `现在是第 ${round} 轮，请你继续完善后提交。`, 100);
    doc.addSection(
        'Constraints',
        [
            '完成任务后，必须调用 return 工具',
            `reason: 第 ${round} 轮工作记录`,
            'affected_files: 你创建或修改的每个文件',
            '不要用文字表示完成。只有工具调用才算数。',
        ],
        100,
    );

    return doc.compile();
}

function buildConfirmPrompt(node) {
    const doc = new PromptDoc();
    const task = typeof node === 'string' ? node : node.task;

    doc.addSection(
        'Role',
        '你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。',
        100,
    );
    doc.addSection('原始任务', task, 100);

    if (node?.review_criteria?.length) {
        doc.addSection(
            '评审标准',
            node.review_criteria.map((c) => `${c.name}: ${c.description}`),
            80,
        );
    }

    doc.addSection(
        'Dimensions',
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
        '请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })',
        100,
    );

    return doc.compile();
}

export { buildWorkerPrompt, buildConfirmPrompt };
