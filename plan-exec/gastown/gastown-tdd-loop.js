/**
 * GAS TOWN — TDD 循环协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
  const input = await task('返回 TDD-loop 输入：red/green/refactor（函数或逻辑描述）、testRunner、config', {
    type: 'object',
    properties: {
      red: {}, green: {}, refactor: {}, testRunner: {}, config: { type: 'object' },
    }
  })
  const { red, green, refactor, testRunner, config } = input
  const maxCycles = config.maxCycles ?? 5

  const cycles = []
  let allGreen = true

  for (let c = 1; c <= maxCycles; c++) {
    const cycle = { c }

    // RED
    cycle.red = red
      ? await task(`TDD Cycle ${c} RED：编写未通过的测试`, { type: 'object' })
      : {}
    const pre = testRunner
      ? await task(`TDD Cycle ${c} RED-Check：验证测试确实失败`, { type: 'object', properties: { passed: {type:'boolean'} } })
      : { passed: false }
    if (pre.passed) cycle.redCheck = { note: '假阳性：RED 阶段测试通过了' }

    // GREEN
    cycle.green = green
      ? await task(`TDD Cycle ${c} GREEN：最小实现使测试通过。测试：${JSON.stringify(cycle.red)}`, { type: 'object' })
      : {}
    const greenCheck = testRunner
      ? await task(`TDD Cycle ${c} GREEN-Check：验证实现通过测试`, { type: 'object', properties: { passed: {type:'boolean'} } })
      : { passed: true }
    if (!greenCheck.passed) { allGreen = false; cycles.push(cycle); break }

    // REFACTOR
    if (refactor) {
      cycle.refactor = await task(`TDD Cycle ${c} REFACTOR：重构代码。实现：${JSON.stringify(cycle.green)}`, { type: 'object' })
      const refactorCheck = testRunner
        ? await task(`TDD Cycle ${c} REFACTOR-Check：重构后测试仍通过`, { type: 'object', properties: { passed: {type:'boolean'} } })
        : { passed: true }
      if (!refactorCheck.passed) { allGreen = false; cycles.push(cycle); break }
    }

    // 覆盖率门控
    if (testRunner && config.coverageThreshold) {
      const cov = await task(`TDD Cycle ${c} 覆盖率检查：threshold=${config.coverageThreshold}`, { type: 'object', properties: { coverage: {type:'number'} } })
      cycle.coverage = cov.coverage
      if (cov.coverage < config.coverageThreshold) cycle.coverageBlocked = true
    }

    cycles.push(cycle)
    if (!cycle.coverageBlocked) break
  }

  return await task(`TDD Loop 完成：ok=${allGreen}, cycles=${cycles.length}`, {
    type: 'object',
    properties: { ok: {type: 'boolean'}, cycles: {type: 'array'} }
  })
}
