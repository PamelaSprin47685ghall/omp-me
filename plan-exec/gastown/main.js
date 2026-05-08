/**
 * GAS TOWN — 总入口
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
    const mode = await task(
        '返回要执行的模式：dag / gatekeeper / review-loop / tdd-loop / convoy / merge-queue / patrol / orchestrator / molecule',
        {
            type: 'string',
            enum: [
                'dag',
                'gatekeeper',
                'review-loop',
                'tdd-loop',
                'convoy',
                'merge-queue',
                'patrol',
                'orchestrator',
                'molecule',
            ],
        },
    );

    switch (mode) {
        case 'dag':
            return await task('执行 DAG 协议', { type: 'object' });
        case 'gatekeeper':
            return await task('执行 Gatekeeper 协议', { type: 'object' });
        case 'review-loop':
            return await task('执行 Review-Loop 协议', { type: 'object' });
        case 'tdd-loop':
            return await task('执行 TDD-Loop 协议', { type: 'object' });
        case 'convoy':
            return await task('执行 Convoy 协议', { type: 'object' });
        case 'merge-queue':
            return await task('执行 Merge-Queue 协议', { type: 'object' });
        case 'patrol':
            return await task('执行 Patrol 协议', { type: 'object' });
        case 'orchestrator':
            return await task('执行 Orchestrator 协议', { type: 'object' });
        case 'molecule':
            return await task('执行 Molecule 协议', { type: 'object' });
        default:
            throw new Error('Unknown mode: ' + mode);
    }
}
