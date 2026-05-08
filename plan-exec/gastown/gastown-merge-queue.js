/**
 * GAS TOWN — 熔炉合并协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
    const input = await task('返回 merge-queue 输入：convoys（含 beads）、qualityGate config', {
        type: 'object',
        properties: {
            convoys: { type: 'array' },
            qualityGate: { type: 'object' },
        },
    });
    const { convoys, qualityGate } = input;

    // 1. 收集 artifacts
    const artifacts = convoys.flatMap((c) => c.beads || []);

    // 2. 质量门控
    const gate = await task(
        `Merge Queue 质量门控：artifacts=${artifacts.length}，config=${JSON.stringify(qualityGate)}`,
        {
            type: 'object',
            properties: { passed: { type: 'boolean' }, tally: { type: 'object' } },
        },
    );

    if (!gate.passed) {
        return await task(`Merge Queue 被门控拦截`, {
            type: 'object',
            properties: { ok: { type: 'boolean', const: false }, blockedBy: { type: 'string', const: 'quality gate' } },
        });
    }

    // 3. 冲突检测
    const conflicts = await task(`Merge Queue 冲突检测：artifacts=${JSON.stringify(artifacts)}`, { type: 'array' });

    // 4. 并行修复
    const fixed = conflicts.length
        ? await task(`Merge Queue 修复冲突：${JSON.stringify(conflicts)}`, { type: 'array' })
        : [];

    // 5. 集成验证
    const verify = await task(`Merge Queue 集成验证：合并后完整测试`, {
        type: 'object',
        properties: { ok: { type: 'boolean' }, testResults: { type: 'object' } },
    });

    return await task(`Merge Queue 完成：ok=${verify.ok}`, {
        type: 'object',
        properties: {
            ok: { type: 'boolean' },
            merged: { type: 'array' },
            conflictsFixed: { type: 'array' },
            gate: { type: 'object' },
            verify: { type: 'object' },
        },
    });
}
