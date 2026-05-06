/**
 * GAS TOWN — 总控编排协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
  const input = await task('返回 orchestrator 输入：goal、topologyHint（可选）', {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      topologyHint: { type: 'string' },
    }
  })
  const { goal } = input

  // 1. 拓扑选择
  const analysis = await task(`总控分析目标：${goal}`, { type: 'object', properties: { topology: {type:'string'} } })
  const topology = analysis.topology || 'dag'

  // 2. 分解
  const work = await task(`总控分解：topology=${topology}，goal=${goal}`, { type: 'object' })

  // 3. 执行
  let result
  switch (topology) {
    case 'dag':         result = await task(`执行 DAG：${JSON.stringify(work.graph)}`, { type: 'object' }); break
    case 'gatekeeper':  result = await task(`执行 Gatekeeper：${JSON.stringify(work.ballots)}`, { type: 'object' }); break
    case 'review-loop': result = await task(`执行 Review-Loop`, { type: 'object' }); break
    case 'tdd-loop':    result = await task(`执行 TDD-Loop`, { type: 'object' }); break
    case 'convoy':      result = await task(`执行 Convoy：goal=${goal}`, { type: 'object' }); break
    default:            result = await task(`执行 DAG：${JSON.stringify(work.graph)}`, { type: 'object' })
  }

  // 4. 集成验证
  const verify = await task(`集成验证：topology=${topology}`, { type: 'object', properties: { ok: {type:'boolean'} } })

  // 5. 巡逻
  const patrol = await task(`执行 Patrol`, { type: 'object' })

  return await task(`编排完成`, {
    type: 'object',
    properties: { ok: {type:'boolean'}, topology: {type:'string'}, result: {type:'object'}, verify: {type:'object'}, patrol: {type:'object'} }
  })
}
