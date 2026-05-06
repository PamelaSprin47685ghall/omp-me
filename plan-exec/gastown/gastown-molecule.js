/**
 * @process methodologies/gastown/gastown-molecule
 * @description DURABLE WORKFLOW TEMPLATE — Feel free to use inside ANY subtask.
 *   This is not a Gas Town role; it is a reusable pattern for defining
 *   multi-step durable workflows with checkpointing. A subtask may call
 *   taskjs(path.join(GASTOWN_HOME, 'gastown-molecule.js'), { formulaSpec: ... })
 *   and the molecule will execute the steps, retry on failure, and return.
 *   You may nest molecules inside molecules (a molecule step can itself
 *   be a taskjs() call to this same file with a new formula).
 * @args { formulaSpec?: object, steps?: array, variables?: object, checkpointInterval?: number }
 * @outputs { success: boolean, moleculeId: string, stepsCompleted: number, checkpoints: array, result: object }
 *
 * Attribution: Adapted from https://github.com/steveyegge/gastown by Steve Yegge
 */

async function main(args, task, taskjs) {
  const formulaSpec = args?.formulaSpec ?? null
  const steps = args?.steps ?? []
  const variables = args?.variables ?? {}
  const checkpointInterval = args?.checkpointInterval ?? 1

  const moleculeId = `mol-${Date.now()}`

  // -------------------------------------------------------------------
  // If a formulaSpec is provided, validate it; otherwise use inline steps.
  // -------------------------------------------------------------------

  let resolvedSteps = steps
  if (formulaSpec) {
    const formulaResult = await task(
      `Validate and expand formula. Spec: ${JSON.stringify(formulaSpec)}. Variables: ${JSON.stringify(variables)}`,
      {
        type: 'object',
        properties: {
          steps: { type: 'array' },
          variables: { type: 'object' },
          validationResult: { type: 'object' },
        },
      },
    )
    resolvedSteps = formulaResult.steps
  }

  // -------------------------------------------------------------------
  // Execute steps with optional checkpointing.
  // Each step can itself be any work: task(), taskjs(), or inline JS.
  // -------------------------------------------------------------------

  const stepResults = []
  const checkpoints = []
  const totalSteps = resolvedSteps.length

  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
    const stepDef = resolvedSteps[stepIndex]

    // A step definition may declare a nested molecule or a plain task.
    let stepResult
    if (stepDef?.type === 'molecule') {
      // Nested molecule: re-enter the same template with a sub-formula.
      stepResult = await taskjs(
        path.join(GASTOWN_HOME, 'gastown-molecule.js'),
        {
          formulaSpec: stepDef.nestedFormula,
          variables: { ...variables, ...stepDef.nestedVariables },
          checkpointInterval,
        },
      )
    } else {
      stepResult = await task(
        `Execute molecule ${moleculeId} step ${stepIndex + 1}/${totalSteps}. Definition: ${JSON.stringify(stepDef)}. Previous outputs: ${JSON.stringify(stepResults.map((s) => s.output))}`,
        {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            output: { type: 'object' },
            sideEffects: { type: 'array' },
            duration: { type: 'number' },
            nextStepOverride: { type: 'number' },
          },
        },
      )
    }

    stepResults.push({
      stepIndex,
      success: stepResult.success,
      output: stepResult.output,
      duration: stepResult.duration,
    })

    // Checkpoint at configured intervals
    if ((stepIndex + 1) % checkpointInterval === 0) {
      const checkpoint = await task(
        `Checkpoint progress for molecule ${moleculeId} at step ${stepIndex + 1}`,
        {
          type: 'object',
          properties: {
            checkpointId: { type: 'string' },
            savedAt: { type: 'string' },
            stateHash: { type: 'string' },
            recoveryPoint: { type: 'number' },
          },
        },
      )
      checkpoints.push(checkpoint)
    }

    // Handle step override (formula can redirect flow)
    if (stepResult?.nextStepOverride !== undefined && stepResult.nextStepOverride !== null) {
      stepIndex = stepResult.nextStepOverride - 1 // loop increment compensates
    }
  }

  const completionResult = await task(
    `Complete molecule ${moleculeId} workflow. All step results: ${JSON.stringify(stepResults)}`,
    {
      type: 'object',
      properties: {
        result: { type: 'object' },
        summary: { type: 'string' },
        artifacts: { type: 'array' },
        duration: { type: 'number' },
        attribution: { type: 'object' },
      },
    },
  )

  return {
    success: stepResults.every((s) => s.success),
    moleculeId,
    stepsCompleted: stepResults.filter((s) => s.success).length,
    totalSteps,
    checkpoints: checkpoints.map((c) => ({ id: c.checkpointId, savedAt: c.savedAt })),
    result: completionResult.result,
    metadata: {
      processId: 'methodologies/gastown/gastown-molecule',
      attribution: 'https://github.com/steveyegge/gastown',
      author: 'Steve Yegge',
      timestamp: new Date().toISOString(),
    },
  }
}
