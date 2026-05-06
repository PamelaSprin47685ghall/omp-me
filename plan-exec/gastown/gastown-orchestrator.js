/**
 * @process methodologies/gastown/gastown-orchestrator
 * @description Gas Town Mayor Orchestrator - Global coordinator that initiates Convoys, assigns agents, monitors execution, and handles escalations following the GUPP principle
 * @args { goal: string, projectRoot?: string, agentPool?: array, maxConvoys?: number, qualityThreshold?: number }
 * @outputs { success: boolean, convoys: array, agentAttribution: object, mergeResults: array, summary: object }
 *
 * Attribution: Adapted from https://github.com/steveyegge/gastown by Steve Yegge
 */

async function main(args, task, taskjs) {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const agentMd = await readFile(join(GASTOWN_HOME, 'agents/mayor/AGENT.md'), 'utf-8')
  const as = (task) => `You are acting as the agent defined below. Follow this role definition precisely.\n\n--- AGENT.md START ---\n${agentMd}\n--- AGENT.md END ---\n\nNow execute:\n${task}`

  const goal = args?.goal ?? 'Implement feature';
  const projectRoot = args?.projectRoot ?? '.';
  const agentPool = args?.agentPool ?? ['crew-lead', 'polecat'];
  const maxConvoys = args?.maxConvoys ?? 3;
  const qualityThreshold = args?.qualityThreshold ?? 80;

  // ============================================================================
  // STEP 1: SETUP TOWN
  // ============================================================================

  const townResult = await task(
    as(`Setup Gas Town infrastructure for goal: ${goal}`),
    {
      type: 'object',
      properties: {
        townConfig: { type: 'object' },
        availableAgents: { type: 'array' },
        hookHierarchy: { type: 'object' },
        gitState: { type: 'object' }
      }
    }
  );

  // ============================================================================
  // STEP 2: ANALYZE WORK (MEOW Decomposition)
  // ============================================================================

  const analysisResult = await task(
    as(`Analyze work and decompose into MEOWs for: ${goal}`),
    {
      type: 'object',
      properties: {
        meows: { type: 'array' },
        dependencies: { type: 'object' },
        estimatedConvoys: { type: 'number' },
        complexity: { type: 'string' }
      }
    }
  );

  // ============================================================================
  // STEP 3-5: CREATE AND EXECUTE CONVOYS
  // ============================================================================

  const convoyResults = [];
  const allMergeResults = [];
  const agentAttribution = {};
  const convoyCount = Math.min(analysisResult.estimatedConvoys, maxConvoys);

  for (let i = 0; i < convoyCount; i++) {
    // Create convoy
    const convoy = await task(
      as(`Create Convoy ${i + 1}/${convoyCount} from MEOWs`),
      {
        type: 'object',
        properties: {
          convoyId: { type: 'string' },
          beads: { type: 'array' },
          assignmentPlan: { type: 'object' },
          hooks: { type: 'array' }
        }
      }
    );

    // Assign workers
    const assignments = await task(
      as(`Assign workers to Convoy ${convoy.convoyId}`),
      {
        type: 'object',
        properties: {
          assignments: { type: 'array' },
          crewAssignments: { type: 'array' },
          polecatAssignments: { type: 'array' },
          hookSetup: { type: 'object' }
        }
      }
    );

    // Monitor execution
    const monitorResult = await task(
      as(`Monitor Convoy ${convoy.convoyId} execution`),
      {
        type: 'object',
        properties: {
          progress: { type: 'object' },
          stuckAgents: { type: 'array' },
          completedBeads: { type: 'array' },
          pendingBeads: { type: 'array' },
          healthStatus: { type: 'string' }
        }
      }
    );

    // Handle stuck agents
    if (monitorResult.stuckAgents.length > 0) {
      for (const stuckAgent of monitorResult.stuckAgents) {
        await task(
          as(`Handle escalation for stuck agent ${stuckAgent} in Convoy ${convoy.convoyId}`),
          {
            type: 'object',
            properties: {
              resolution: { type: 'string' },
              action: { type: 'string' },
              reassignment: { type: 'object' },
              nudgeMessage: { type: 'string' }
            }
          }
        );
      }
    }

    // Merge review
    const mergeResult = await task(
      as(`Review merged results for Convoy ${convoy.convoyId}`),
      {
        type: 'object',
        properties: {
          approved: { type: 'boolean' },
          qualityScore: { type: 'number' },
          issues: { type: 'array' },
          attribution: { type: 'object' }
        }
      }
    );

    convoyResults.push({ convoy, assignments, monitorResult, mergeResult });
    allMergeResults.push(mergeResult);

    // Collect attribution
    for (const assignment of assignments.assignments) {
      const agentId = assignment.agentId || 'unknown';
      if (!agentAttribution[agentId]) {
        agentAttribution[agentId] = { beadsCompleted: 0, convoys: [] };
      }
      agentAttribution[agentId].beadsCompleted += 1;
      agentAttribution[agentId].convoys.push(convoy.convoyId);
    }
  }

  // ============================================================================
  // STEP 7: COMPLETION SUMMARY
  // ============================================================================

  const summaryResult = await task(
    as(`Generate completion summary for goal: ${goal}`),
    {
      type: 'object',
      properties: {
        summary: { type: 'object' },
        totalBeads: { type: 'number' },
        agentScores: { type: 'object' },
        lessonsLearned: { type: 'array' }
      }
    }
  );

  return {
    success: true,
    goal: goal,
    convoys: convoyResults.map(c => ({
      convoyId: c.convoy.convoyId,
      beadCount: c.convoy.beads.length,
      qualityScore: c.mergeResult.qualityScore,
      approved: c.mergeResult.approved
    })),
    agentAttribution,
    mergeResults: allMergeResults,
    summary: summaryResult.summary,
    metadata: {
      processId: 'methodologies/gastown/gastown-orchestrator',
      attribution: 'https://github.com/steveyegge/gastown',
      author: 'Steve Yegge',
      timestamp: new Date().toISOString()
    }
  };
}
