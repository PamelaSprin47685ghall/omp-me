/**
 * GAS TOWN — 分子协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
  const input = await task('返回 molecule 输入：steps（数组）、checkpointInterval、loopUntil（可选）', {
    type: 'object',
    properties: {
      steps: { type: 'array' },
      checkpointInterval: { type: 'number' },
      loopUntil: {},
    }
  })
  const { steps, checkpointInterval, loopUntil } = input

  const checkpoints = []
  const history = []

  let i = 0
  while (i < steps.length) {
    const step = steps[i]

    let result
    switch (step.type) {
      case 'task':       result = await task(`执行分子步骤 ${i}（task）`, { type: 'object' }); break
      case 'dag':        result = await task(`执行分子步骤 ${i}（dag）`, { type: 'object' }); break
      case 'gatekeeper': result = await task(`执行分子步骤 ${i}（gatekeeper）`, { type: 'object' }); break
      case 'review':     result = await task(`执行分子步骤 ${i}（review）`, { type: 'object' }); break
      case 'tdd':        result = await task(`执行分子步骤 ${i}（tdd）`, { type: 'object' }); break
      case 'loop':       result = await task(`执行分子步骤 ${i}（loop）`, { type: 'object' }); break
      default:           throw new Error('Unknown step type: ' + step.type)
    }

    history.push({ step: i, type: step.type, result })

    if ((i + 1) % (checkpointInterval || 1) === 0) {
      checkpoints.push({ step: i, hash: await task(`Checkpoint at step ${i}`, { type: 'string' }) })
    }

    if (result.nextStep != null) { i = result.nextStep; continue }

    if (i === steps.length - 1 && loopUntil) {
      const shouldContinue = await task(`loop-until 检查`, { type: 'boolean' })
      if (shouldContinue) { i = 0; continue }
    }

    i++
  }

  const allOk = history.every(h => h.result?.ok !== false)
  return await task(`Molecule 完成`, {
    type: 'object',
    properties: { ok: {type:'boolean'}, history: {type:'array'}, checkpoints: {type:'array'} }
  })
}
