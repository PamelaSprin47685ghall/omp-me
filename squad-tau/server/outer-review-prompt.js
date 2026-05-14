import { PromptDoc } from './prompt-builder.js';

export function buildOuterReviewPrompt(originalTask, nodeResults, round) {
    const doc = new PromptDoc();
    doc.addSection('Role', '你现在是 Squad-Tau 最终审核者，负责评审多节点协作的聚合结果。', 100);
    doc.addSection('原始任务:', originalTask, 100);

    const nodeLines = nodeResults.map((nr) => {
        const files = nr.affectedFiles?.length ? `, 文件: ${nr.affectedFiles.join(', ')}` : '';
        return `${nr.id} (${nr.status}): ${nr.summary || ''}${files}`;
    });
    doc.addSection('节点结果:', nodeLines, 100);

    doc.addSection(
        'Instruction',
        [
            '聚合结果是否满足原始任务？',
            '- 满足：return({ status: "ok", reason: "..." })',
            '- 不满足：return({ status: "error", reason: "..." }) 附详细修改意见',
        ],
        100,
    );

    return doc.compile();
}
