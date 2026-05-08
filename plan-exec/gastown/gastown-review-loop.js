/**
 * GAS TOWN — 审查循环协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
    const input = await task('返回 review-loop 输入：author（函数）、reviewers（数组）、config', {
        type: 'object',
        properties: {
            author: {},
            reviewers: { type: 'array' },
            config: { type: 'object' },
        },
    });
    const { author, reviewers, config } = input;
    const maxRounds = config.maxRounds ?? 4;

    let deliverable = null;
    let history = [];

    for (let round = 1; round <= maxRounds; round++) {
        const fb = history.length ? history[history.length - 1].feedback : null;

        // 作者编写
        deliverable = author
            ? await task(`Review Loop Round ${round}：作者编写。上一轮反馈：${JSON.stringify(fb)}`, { type: 'object' })
            : await task(`Review Loop Round ${round}：需要作者产出`, { type: 'object' });

        // 审查者并行审查
        const reviews = await Promise.all(
            reviewers.map((r, i) =>
                task(`Reviewer ${i} 审查 Round ${round} 产出：${JSON.stringify(deliverable)}`, {
                    type: 'object',
                    properties: {
                        verdict: { type: 'string', enum: ['accept', 'reject'] },
                        comments: { type: 'array' },
                        confidence: { type: 'number' },
                    },
                }),
            ),
        );

        const accepts = reviews.filter((r) => r.verdict === 'accept').length;
        const total = reviews.length;
        let ok = false;
        switch (config.quorumMode) {
            case 'unanimity':
                ok = accepts === total;
                break;
            case 'majority':
                ok = accepts > total / 2;
                break;
            default:
                ok = accepts === total;
        }

        if (!ok && config.arbitration) {
            ok = await task(`仲裁 Round ${round}：reviews=${JSON.stringify(reviews)}`, { type: 'boolean' });
        }

        const feedback = { accepted: ok, reviews };
        history.push({ round, deliverable, reviews, feedback });

        if (ok) break;
    }

    const accepted = history.length > 0 && history[history.length - 1].feedback.accepted;
    return await task(`Review Loop 完成：accepted=${accepted}, rounds=${history.length}`, {
        type: 'object',
        properties: {
            accepted: { type: 'boolean' },
            rounds: { type: 'number' },
            deliverable: {},
            history: { type: 'array' },
        },
    });
}
