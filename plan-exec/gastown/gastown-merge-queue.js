/**
 * @process methodologies/gastown/gastown-merge-queue
 * @description Gas Town Refinery — Integration Compatibility Enforcement
 *   Collects convoy outputs, detects cross-module conflicts, repairs them
 *   by dispatching fix agents, and verifies integration until success.
 * @args { convoyResults: array, goal: string, projectRoot?: string }
 * @outputs { success: boolean, compatible: boolean, fixCount: number, integrationReport: object }
 *
 * Attribution: Adapted from https://github.com/steveyegge/gastown by Steve Yegge
 */

async function main(args, task, taskjs) {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const agentMd = await readFile(join(GASTOWN_HOME, 'agents/refinery/AGENT.md'), 'utf-8')
  const as = (task) => `You are acting as the agent defined below. Follow this role definition precisely.\n\n--- AGENT.md START ---\n${agentMd}\n--- AGENT.md END ---\n\nNow execute:\n${task}`

  const convoyResults = args?.convoyResults ?? []
  const goal = args?.goal ?? 'Implement feature'
  const projectRoot = args?.projectRoot ?? '.'

  // ========================================================================
  // STEP 1: COLLECT ARTIFACTS
  // ========================================================================

  const artifacts = convoyResults.flatMap((c) =>
    (c.beads || []).map((b) => ({
      convoyId: c.convoyId,
      beadId: b.id || 'unknown',
      exports: b.exports || {},
      interfaces: b.interfaces || [],
      schema: b.schema || {},
      codeSummary: b.codeSummary || '',
      files: b.files || [],
    })),
  )

  const collectResult = await task(
    as(`Normalise ${artifacts.length} bead artifacts from ${convoyResults.length} convoys. Goal: ${goal}. Build a module graph of public interfaces, shared schemas, and entry-point files.`),
    {
      type: 'object',
      properties: {
        normalisedArtifacts: { type: 'array' },
        sharedInterfaces: { type: 'array' },
        sharedSchemas: { type: 'array' },
        moduleGraph: { type: 'object' },
      },
    },
  )

  // ========================================================================
  // STEP 2: DETECT COMPATIBILITY CONFLICTS
  // ========================================================================

  const conflictResult = await task(
    as(`Detect cross-module compatibility conflicts across convoys. Shared interfaces: ${JSON.stringify(collectResult.sharedInterfaces)}. Shared schemas: ${JSON.stringify(collectResult.sharedSchemas)}. Module graph: ${JSON.stringify(collectResult.moduleGraph)}. Report API mismatches, schema drift, naming collisions, type mismatches, and missing dependencies.`),
    {
      type: 'object',
      properties: {
        conflicts: { type: 'array' },
        conflictPairs: { type: 'array' },
        severity: { type: 'object' },
        autoResolvable: { type: 'array' },
        manualRequired: { type: 'array' },
      },
    },
  )

  // ========================================================================
  // STEP 3: REPAIR LOOP — dispatch fix agents until clean
  // ========================================================================

  const MAX_REPAIR_ROUNDS = 3
  let repairRounds = 0
  let resolvedConflicts = 0
  let unresolvedConflicts = conflictResult.conflicts.length
  let repairLog = []

  while (unresolvedConflicts > 0 && repairRounds < MAX_REPAIR_ROUNDS) {
    repairRounds++

    const fixResult = await task(
      as(`Repair ${unresolvedConflicts} compatibility conflicts in ${projectRoot}. Conflicts: ${JSON.stringify(conflictResult.conflicts)}. Auto-resolvable: ${JSON.stringify(conflictResult.autoResolvable)}. Do NOT just report — actually modify source files to fix the conflicts (align schemas, unify interfaces, rename collisions, add missing type annotations). Run relevant tests to confirm each fix.`),
      {
        type: 'object',
        properties: {
          fixedCount: { type: 'number' },
          remainingCount: { type: 'number' },
          filesModified: { type: 'array' },
          testResults: { type: 'object' },
          fixLog: { type: 'array' },
        },
      },
    )

    resolvedConflicts += fixResult.fixedCount
    unresolvedConflicts = fixResult.remainingCount
    repairLog.push({
      round: repairRounds,
      fixed: fixResult.fixedCount,
      remaining: fixResult.remainingCount,
      filesModified: fixResult.filesModified,
      testResults: fixResult.testResults,
    })

    if (fixResult.remainingCount === 0) break
  }

  // ========================================================================
  // STEP 4: INTEGRATION VERIFICATION — must pass
  // ========================================================================

  let integrationResult = await task(
    as(`Run full integration verification in ${projectRoot}. Build, type-check, lint, and run all tests. Ensure every module produced by the convoys works together. Report any remaining blockers.`),
    {
      type: 'object',
      properties: {
        allPassed: { type: 'boolean' },
        testResults: { type: 'object' },
        buildResult: { type: 'object' },
        lintResult: { type: 'object' },
        typeCheckResult: { type: 'object' },
        compatibilityScore: { type: 'number' },
        remainingBlockers: { type: 'array' },
      },
    },
  )

  // If integration fails, attempt one more targeted repair pass
  if (!integrationResult.allPassed && repairRounds < MAX_REPAIR_ROUNDS) {
    repairRounds++

    const emergencyFix = await task(
      as(`Emergency fix for remaining integration blockers in ${projectRoot}. Blockers: ${JSON.stringify(integrationResult.remainingBlockers)}. Modify files to resolve them, re-run tests, confirm green.`),
      {
        type: 'object',
        properties: {
          fixedCount: { type: 'number' },
          filesModified: { type: 'array' },
          testResults: { type: 'object' },
        },
      },
    )

    repairLog.push({
      round: repairRounds,
      fixed: emergencyFix.fixedCount,
      remaining: integrationResult.remainingBlockers.length - emergencyFix.fixedCount,
      filesModified: emergencyFix.filesModified,
      testResults: emergencyFix.testResults,
    })

    // Re-verify
    integrationResult = await task(
      as(`Re-run integration verification after emergency fixes. Confirm build, type-check, lint, and all tests pass.`),
      {
        type: 'object',
        properties: {
          allPassed: { type: 'boolean' },
          testResults: { type: 'object' },
          buildResult: { type: 'object' },
          lintResult: { type: 'object' },
          typeCheckResult: { type: 'object' },
          compatibilityScore: { type: 'number' },
          remainingBlockers: { type: 'array' },
        },
      },
    )
  }

  // ========================================================================
  // STEP 5: RETURN — success only when integration is green
  // ========================================================================

  const allClean = unresolvedConflicts === 0 && integrationResult.allPassed

  return {
    success: allClean,
    compatible: allClean,
    fixCount: resolvedConflicts,
    repairRounds,
    repairLog,
    integrationReport: {
      compatibilityScore: integrationResult.compatibilityScore,
      testResults: integrationResult.testResults,
      buildResult: integrationResult.buildResult,
      lintResult: integrationResult.lintResult,
      typeCheckResult: integrationResult.typeCheckResult,
      remainingBlockers: integrationResult.remainingBlockers,
    },
    metadata: {
      processId: 'methodologies/gastown/gastown-merge-queue',
      attribution: 'https://github.com/steveyegge/gastown',
      author: 'Steve Yegge',
      timestamp: new Date().toISOString(),
    },
  }
}
