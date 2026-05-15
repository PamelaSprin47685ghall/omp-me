/**
 * Prompt Virtual Document Model (Prompt DOM) and Compiler.
 * Eliminates whitespace issues and enables dynamic pruning based on token limits.
 */

/**
 * Common sections injected into worker / confirming / reviewer prompts.
 * Review criteria — 3 identical patterns collapsed into 1.
 * Iteration history — unified format superset of worker & reviewer.
 */
function buildCommonSections(node) {
    const sections = [];
    if (node.review_criteria?.length) {
        sections.push({
            title: '评审标准:',
            content: node.review_criteria.map((c) => `${c.name}: ${c.description}`),
            priority: 80,
        });
    }
    if (node.history?.length) {
        sections.push({
            title: 'Iteration History',
            content: node.history.map((entry, i) => {
                const lines = [`工作记录 (${i + 1}): ${entry.workRecord?.reason || ''}`];
                if (entry.workRecord?.affected_files?.length > 0) {
                    lines.push(`  文件: ${entry.workRecord.affected_files.join(', ')}`);
                }
                lines.push(`审阅者反馈 (${i + 1}): ${entry.feedback || ''}`);
                return lines.join('\n');
            }),
            priority: 50,
        });
    }
    return sections;
}

/**
 * Mode-conditional section injected into worker prompts.
 * M = single-node, L = multi-node — different psychological framings.
 */
function modeWarningSection(state) {
    if (state.squad.mode === 'M') {
        return [
            {
                title: '工作模式',
                content:
                    '你是本次任务的唯一执行者。你必须在本次提交中完成所有闭环，不要指望其他节点来擦屁股。确保全局变量、依赖引用在单个模块内绝对正确。',
                priority: 110,
            },
        ];
    }
    if (state.squad.mode === 'L') {
        return [
            {
                title: '工作模式',
                content:
                    '你只负责整个系统的一部分（见你的任务描述）。严禁越界修改不属于你职责的核心文件。若上游文件有误，记录在案，不要强行覆盖。',
                priority: 110,
            },
        ];
    }
    return [];
}

class PromptDoc {
    constructor(sections) {
        this.sections = [];
        if (sections) {
            for (const s of sections) this.addSection(s.title, s.content, s.priority);
        }
    }

    addSection(title, content, priority = 10) {
        if (!content || (Array.isArray(content) && content.length === 0)) return this;
        this.sections.push({ title, content, priority });
        return this;
    }

    compile() {
        return this.sections
            .map((section) => {
                const header = section.title ? `### ${section.title}\n` : '';
                let body = '';
                if (Array.isArray(section.content)) {
                    body = section.content
                        .filter(Boolean)
                        .map((item) => item.toString().trim())
                        .map((item) => (item.startsWith('-') ? item : `- ${item}`))
                        .join('\n');
                } else {
                    body = section.content.toString().trim();
                }
                return `${header}${body}`;
            })
            .filter(Boolean)
            .join('\n\n');
    }
}

const PROMPT_TEMPLATES = {
    worker: (state, node) => {
        const upstreamResults = state.squad.nodes
            .filter((n) => (node.depends_on || []).includes(n.id))
            .map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary, affectedFiles: n.affectedFiles }));
        const round = (node.history?.length || 0) + 1;
        return [
            { title: 'Role', content: '你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。', priority: 100 },
            { title: '你的任务:', content: node.task, priority: 100 },
            ...modeWarningSection(state),
            ...(upstreamResults.length
                ? [
                      {
                          title: '上游任务结果:',
                          content: upstreamResults.map((u) => {
                              const files = u.affectedFiles?.length ? ` (Files: ${u.affectedFiles.join(', ')})` : '';
                              return `${u.nodeId}: ${u.summary}${files}`;
                          }),
                          priority: 60,
                      },
                  ]
                : []),
            ...buildCommonSections(node),
            { title: 'Status', content: `现在是第 ${round} 轮，请你继续完善后提交。`, priority: 100 },
            {
                title: 'Constraints',
                content: [
                    '完成任务后，必须调用 return 工具',
                    `reason: 第 ${round} 轮工作记录`,
                    'affected_files: 你创建或修改的每个文件',
                    '不要用文字表示完成。只有工具调用才算数。',
                ],
                priority: 100,
            },
        ];
    },

    confirming: (state, node) => {
        const task = typeof node === 'string' ? node : node.task;
        return [
            {
                title: 'Role',
                content:
                    '你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。',
                priority: 100,
            },
            { title: '原始任务', content: task, priority: 100 },
            ...buildCommonSections(node),
            {
                title: 'Dimensions',
                content: [
                    '代码质量 — 是否正确、清晰、符合惯例？',
                    '设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？',
                    '用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？',
                    '目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？',
                ],
                priority: 100,
            },
            {
                title: 'Instruction',
                content: '请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })',
                priority: 100,
            },
        ];
    },

    reviewer: (state, node) => {
        const history = node.history || [];
        const currentRound = history.length + 1;
        const workerSession = Object.values(state.sessions).find(
            (s) => s.nodeId === node.id && s.role === 'worker_confirm',
        );
        const workerReturn = workerSession?.latestReturn || {
            status: 'ok',
            reason: 'Initial submission',
            affected_files: [],
        };
        return [
            { title: 'Role', content: '你现在是 Squad-Tau 审核专员，负责评审工程师的交付。', priority: 100 },
            { title: '原始任务:', content: node.task, priority: 100 },
            ...buildCommonSections(node),
            {
                title: `Work Record (${currentRound})`,
                content: [
                    `工作记录 (${currentRound}): ${workerReturn.reason || ''}`,
                    ...(workerReturn.affected_files?.length ? [`文件: ${workerReturn.affected_files.join(', ')}`] : []),
                ],
                priority: 90,
            },
            {
                title: '本次提交的修改文件列表:',
                content: (workerReturn.affected_files || []).map((f) => `  - ${f}`).join('\n') || '（无）',
                priority: 80,
            },
            {
                title: '审查维度:',
                content: [
                    '代码质量 — 是否正确、清晰、符合惯例？',
                    '设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？',
                    '用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？',
                    '目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？',
                ],
                priority: 100,
            },
            {
                title: 'Instruction',
                content: [
                    '评审结束时，必须调用名为 return 的工具提交结果：',
                    '- 参数 status: "ok" (通过) 或 "error" (驳回)',
                    '- 参数 reason: 详细的修改意见或通过理由',
                    '不要用纯文本写 return(...) 的假代码。只有真正的工具调用才有效。',
                ],
                priority: 100,
            },
        ];
    },

    outer_review: (state, node) => {
        const allNodeResults = state.squad.nodes.map((n) => ({
            id: n.id,
            status: n.status,
            summary: n.summary,
            affectedFiles: n.affectedFiles,
        }));
        return [
            { title: 'Role', content: '你现在是 Squad-Tau 最终审核者，负责评审多节点协作的聚合结果。', priority: 100 },
            { title: '原始任务:', content: state.squad.originalTask, priority: 100 },
            {
                title: '节点结果:',
                content: allNodeResults.map((nr) => {
                    const files = nr.affectedFiles?.length ? `, 文件: ${nr.affectedFiles.join(', ')}` : '';
                    return `${nr.id} (${nr.status}): ${nr.summary || ''}${files}`;
                }),
                priority: 100,
            },
            {
                title: 'Instruction',
                content: [
                    '聚合结果是否满足原始任务？',
                    '- 满足：return({ status: "ok", reason: "..." })',
                    '- 不满足：return({ status: "error", reason: "..." }) 附详细修改意见',
                ],
                priority: 100,
            },
        ];
    },
};

export { PromptDoc, PROMPT_TEMPLATES };
