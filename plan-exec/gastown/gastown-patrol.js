/**
 * GAS TOWN — 巡逻协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
  const input = await task('返回 patrol 输入：maxCycles、recoveryMode（如果有）', {
    type: 'object',
    properties: {
      maxCycles: { type: 'number' },
      recoveryMode: { type: 'string' },
    }
  })
  const maxCycles = input.maxCycles ?? 10
  const recoveryMode = input.recoveryMode ?? 'reassign'

  const issues = []
  const recoveries = []
  const alerts = []

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const report = await task(`Patrol Cycle ${cycle}：扫描所有代理和拓扑的健康状态`, {
      type: 'object',
      properties: { unhealthy: {type:'array'}, warnings: {type:'array'}, stuckMetrics: {type:'array'} }
    })

    for (const stuck of report.stuckMetrics || []) {
      issues.push({ cycle, ...stuck })
      const action = stuck.cyclesUnchanged <= 1 ? 'retry'
        : recoveryMode === 'retry' ? 'retry-backoff'
        : recoveryMode === 'reassign' ? 'reassign'
        : recoveryMode === 'split' ? 'split-work'
        : 'escalate'
      const result = await task(`Patrol 恢复 ${stuck.agentId}：action=${action}`, { type: 'object' })
      recoveries.push({ cycle, agentId: stuck.agentId, action, result })
    }

    // 预测性告警
    if (cycle > 1) {
      const trend = await task(`Patrol Cycle ${cycle} 趋势分析：对比上一轮`, { type: 'object', properties: { unhealthyGrowth: {type:'number'} } })
      if (trend.unhealthyGrowth > 0) alerts.push({ cycle, severity: 'predictive', msg: 'unhealthy trend rising' })
    }

    // 两轮干净提前退出
    if (!report.unhealthy?.length && !report.stuckMetrics?.length && cycle >= 3) break
  }

  return await task(`Patrol 完成`, {
    type: 'object',
    properties: { ok: {type:'boolean'}, cyclesDone: {type:'number'}, issues: {type:'array'}, recoveries: {type:'array'}, alerts: {type:'array'} }
  })
}
