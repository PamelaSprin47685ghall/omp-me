/**
 * GAS TOWN — 门控协议
 *
 * 签名：async function main(task)
 * task(prompt: string, schema?) — 直接调用 LLM。
 */

async function main(task) {
  // LLM 重写时：硬编码选票和模式
  // const ballots = [{voterId, vote, confidence, reason}, ...]
  // const config = { mode, threshold, tieBreaker }

  const input = await task('返回 gatekeeper 输入：ballots 和 config', {
    type: 'object',
    properties: {
      ballots: { type: 'array' },
      config: { type: 'object' },
    }
  })
  const { ballots, config } = input

  const tally = { total: ballots.length, yes: 0, no: 0, abstain: 0 }
  for (const b of ballots) {
    if (b.vote === 'yes') tally.yes++
    else if (b.vote === 'no') tally.no++
    else tally.abstain++
  }

  const effective = tally.total - tally.abstain
  let passed = false, tie = false

  switch (config.mode) {
    case 'unanimity': passed = tally.yes === tally.total; break
    case 'majority':  passed = tally.yes > effective / 2; tie = tally.yes * 2 === effective; break
    case 'threshold': passed = tally.yes / Math.max(effective, 1) >= (config.threshold ?? 0.5); break
    case 'any-of':    passed = tally.yes >= 1; break
    case 'custom':    passed = await task(`自定义门控判断：${JSON.stringify(tally)}`, { type: 'boolean' }); break
    default:          passed = tally.yes > effective / 2
  }

  if (tie) {
    const resolver = { yes: true, no: false, random: Math.random() > 0.5 }[config.tieBreaker]
    passed = resolver !== undefined ? resolver : await task(`平局裁决：${JSON.stringify(tally)}`, { type: 'boolean' })
  }

  return await task(`门控结果：passed=${passed}`, {
    type: 'object',
    properties: { passed: {type: 'boolean'}, tally: {type: 'object'}, ballots: {type: 'array'} }
  })
}
