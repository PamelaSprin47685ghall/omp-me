/**
 * Gas Town Orchestration Template — skeleton, not a fixed pipeline.
 * taskjs() resolves relative to this file's directory. GASTOWN_HOME is available.
 * Available role modules: orchestrator, convoy, merge-queue, patrol, molecule.
 * Agent roles: crew-lead (persistent), polecat (transient), witness (per-rig).
 */

async function main(args, task, taskjs) {
  const goal = args?.goal ?? 'Implement the requested feature'
  const { join } = await import('node:path')

  const patrolPromise = taskjs(join(GASTOWN_HOME, 'gastown-patrol.js'), args)

  const orchestration = await taskjs(
    join(GASTOWN_HOME, 'gastown-orchestrator.js'),
    { goal },
  )

  const convoyResults = []
  for (const convoyMeta of orchestration.convoys || []) {
    const convoy = await taskjs(
      join(GASTOWN_HOME, 'gastown-convoy.js'),
      {
        goal,
        beadSpecs: convoyMeta.beads,
        agentPool: convoyMeta.agentPool,
      },
    )
    convoyResults.push(convoy)
  }

  const mergeResult = await taskjs(
    join(GASTOWN_HOME, 'gastown-merge-queue.js'),
    {
      goal,
      projectRoot: args?.projectRoot ?? '.',
      convoyResults,
    },
  )

  const patrol = await patrolPromise

  return {
    success:
      orchestration.success &&
      convoyResults.every((c) => c.success) &&
      mergeResult.success,
    goal,
    convoys: convoyResults.map((c) => ({
      convoyId: c.convoyId,
      beadCount: c.beads?.length || 0,
      landed: c.landingResult?.landed,
      agentPool: c.agentPool,
    })),
    merge: {
      compatible: mergeResult.compatible,
      fixCount: mergeResult.fixCount,
      repairRounds: mergeResult.repairRounds,
      compatibilityScore: mergeResult.integrationReport?.compatibilityScore,
      remainingBlockers: mergeResult.integrationReport?.remainingBlockers,
    },
    patrol: {
      cycles: patrol.patrolCycles,
      issues: patrol.issues,
      recoveries: patrol.recoveries,
    },
  }
}
