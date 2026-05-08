/**
 * GAS TOWN — 远征队协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
    const input = await task('返回 convoy 输入：goal、beads（带 dependencies）、land gate config', {
        type: 'object',
        properties: {
            goal: { type: 'string' },
            beads: { type: 'array' },
            gateConfig: { type: 'object' },
        },
    });
    const { goal, beads, gateConfig } = input;

    // 内部直接当 DAG 执行
    const nodes = beads.map((b) => ({ id: b.id, run: b.run }));
    const edges = [];
    for (const b of beads) {
        for (const dep of b.dependencies || []) edges.push({ from: dep, to: b.id });
    }

    const indeg = new Map();
    for (const n of nodes) indeg.set(n.id, 0);
    for (const e of edges) indeg.set(e.to, indeg.get(e.to) + 1);

    const done = new Set(),
        fail = new Set(),
        out = {};
    let ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);

    while (ready.length) {
        const next = [...ready];
        ready = [];
        await Promise.all(
            next.map(async (id) => {
                try {
                    out[id] = await task(`执行 convoy bead ${id}，目标：${goal}`, { type: 'object' });
                    done.add(id);
                } catch (err) {
                    fail.add(id);
                    out[id] = { failed: true };
                }
                for (const e of edges.filter((e) => e.from === id)) {
                    if (indeg.get(e.to) > 0) indeg.set(e.to, indeg.get(e.to) - 1);
                    if (indeg.get(e.to) === 0 && !fail.has(id)) ready.push(e.to);
                }
            }),
        );
    }

    // 着陆门控
    const gate = await task(`Convoy 着陆门控：config=${JSON.stringify(gateConfig)}，beads=${JSON.stringify(out)}`, {
        type: 'object',
        properties: { passed: { type: 'boolean' }, tally: { type: 'object' } },
    });

    return await task(`Convoy 完成：ok=${fail.size === 0 && gate.passed}`, {
        type: 'object',
        properties: {
            ok: { type: 'boolean' },
            beads: { type: 'array' },
            failed: { type: 'array' },
            gate: { type: 'object' },
        },
    });
}
