/**
 * GAS TOWN — DAG 执行协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM 获取/输出数据。
 */

async function main(task) {
    // LLM 重写时：硬编码 goal、nodes、edges 为本地常量
    // 示例：const goal = "实现认证系统"; const nodes = [...]; const edges = [...];

    const graph = await task('返回要执行的 DAG：nodes 和 edges', {
        type: 'object',
        properties: {
            nodes: {
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'string' }, run: { type: 'string' } } },
            },
            edges: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: { from: { type: 'string' }, to: { type: 'string' }, predicate: {} },
                },
            },
        },
    });

    const { nodes, edges } = graph;

    // 建图
    const indeg = new Map();
    for (const n of nodes) indeg.set(n.id, 0);
    for (const e of edges) indeg.set(e.to, indeg.get(e.to) + 1);

    // Kahn + 并行调度
    const done = new Set(),
        fail = new Set(),
        skip = new Set(),
        out = {};
    let ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);

    while (ready.length) {
        const next = [...ready];
        ready = [];
        await Promise.all(
            next.map(async (id) => {
                const node = nodes.find((n) => n.id === id);

                // 条件边
                const upstream = edges.filter((e) => e.to === id && done.has(e.from));
                const passes = upstream.length === 0 || upstream.some((e) => !e.predicate || e.predicate(out[e.from]));
                if (!passes) {
                    skip.add(id);
                    out[id] = { skipped: true };
                    return;
                }

                // 执行（带 2 次重试退避）
                let lastErr = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        out[id] = node.run
                            ? await task(
                                  `执行 DAG 节点 ${id}，输入：${JSON.stringify(Object.fromEntries(upstream.map((e) => [e.from, out[e.from]])))}`,
                                  { type: 'object' },
                              )
                            : {};
                        done.add(id);
                        return;
                    } catch (err) {
                        lastErr = err;
                        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
                    }
                }

                fail.add(id);
                out[id] = { failed: true, error: lastErr?.message };
                for (const e of edges.filter((e) => e.from === id)) {
                    if (!fail.has(e.to)) {
                        fail.add(e.to);
                        out[e.to] = { failed: true, error: 'upstream failed' };
                    }
                }
            }),
        );

        for (const id of next) {
            if ((done.has(id) || skip.has(id)) && !fail.has(id)) {
                for (const e of edges.filter((e) => e.from === id)) {
                    if (indeg.get(e.to) > 0) {
                        indeg.set(e.to, indeg.get(e.to) - 1);
                        if (indeg.get(e.to) === 0 && !fail.has(e.to)) ready.push(e.to);
                    }
                }
            }
        }
    }

    return await task(
        `DAG 执行结果：order=${JSON.stringify([...done, ...skip])}, failed=${JSON.stringify([...fail])}`,
        {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                order: { type: 'array' },
                failed: { type: 'array' },
                out: { type: 'object' },
            },
        },
    );
}
