/**
 * @process methodologies/gastown/gastown-convoy
 * @description Gas Town Convoy Lifecycle - Create, assign, track, and land convoys of related beads (atomic work units)
 * @args { goal: string, beadSpecs?: array, agentPool?: array, trackingMode?: string, landingStrategy?: string }
 * @outputs { success: boolean, convoyId: string, beads: array, completedBeads: array, landingResult: object }
 *
 * Attribution: Adapted from https://github.com/steveyegge/gastown by Steve Yegge
 */

async function main(args, task, taskjs) {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const agentMd = await readFile(join(GASTOWN_HOME, 'agents/crew-lead/AGENT.md'), 'utf-8')
  const as = (task) => `You are acting as the agent defined below. Follow this role definition precisely.\n\n--- AGENT.md START ---\n${agentMd}\n--- AGENT.md END ---\n\nNow execute:\n${task}`

  const goal = args?.goal ?? 'Implement feature';
  const beadSpecs = args?.beadSpecs ?? [];
  const agentPool = args?.agentPool ?? ['polecat', 'crew-lead'];
  const trackingMode = args?.trackingMode ?? 'active';
  const landingStrategy = args?.landingStrategy ?? 'squash';

  const convoyId = `convoy-${Date.now()}`;

  // ============================================================================
  // STEP 1: DECOMPOSE WORK
  // ============================================================================

  const decomposition = await task(
    as(`Decompose goal into beads and wisps: ${goal}`),
    {
      type: 'object',
      properties: {
        beads: { type: 'array' },
        wisps: { type: 'array' },
        dependencies: { type: 'object' },
        estimatedEffort: { type: 'object' }
      }
    }
  );

  // ============================================================================
  // STEP 2: CREATE BEADS
  // ============================================================================

  const beadsResult = await task(
    as(`Create git-backed beads for convoy ${convoyId}. Bead specs: ${JSON.stringify(decomposition.beads)}`),
    {
      type: 'object',
      properties: {
        beads: { type: 'array' },
        hooks: { type: 'array' },
        issueRefs: { type: 'array' },
        branchNames: { type: 'array' }
      }
    }
  );

  // ============================================================================
  // STEP 3: ASSIGN TO AGENTS
  // ============================================================================

  const assignments = await task(
    as(`Assign beads to agents. Pool: ${JSON.stringify(agentPool)}, Dependencies: ${JSON.stringify(decomposition.dependencies)}`),
    {
      type: 'object',
      properties: {
        assignments: { type: 'array' },
        unassigned: { type: 'array' },
        loadBalance: { type: 'object' },
        feedMessages: { type: 'array' }
      }
    }
  );

  // ============================================================================
  // STEP 4: TRACK PROGRESS
  // ============================================================================

  const tracking = await task(
    as(`Track progress for convoy ${convoyId} (mode: ${trackingMode})`),
    {
      type: 'object',
      properties: {
        completed: { type: 'array' },
        inProgress: { type: 'array' },
        blocked: { type: 'array' },
        percentComplete: { type: 'number' },
        timeline: { type: 'object' }
      }
    }
  );

  // ============================================================================
  // STEP 5: VERIFY COMPLETION
  // ============================================================================

  const verification = await task(
    as(`Verify all beads complete for convoy ${convoyId}. Completed: ${tracking.completed.length}`),
    {
      type: 'object',
      properties: {
        allComplete: { type: 'boolean' },
        testResults: { type: 'object' },
        qualityScore: { type: 'number' },
        blockers: { type: 'array' }
      }
    }
  );

  // ============================================================================
  // STEP 6: LAND CONVOY
  // ============================================================================

  const landingResult = await task(
    as(`Land convoy ${convoyId} via ${landingStrategy}. Branches: ${JSON.stringify(beadsResult.branchNames)}`),
    {
      type: 'object',
      properties: {
        landed: { type: 'boolean' },
        mergeCommit: { type: 'string' },
        conflicts: { type: 'array' },
        attribution: { type: 'object' },
        cleanedWisps: { type: 'array' }
      }
    }
  );

  return {
    success: landingResult.landed,
    convoyId,
    beads: beadsResult.beads,
    completedBeads: tracking.completed,
    landingResult: {
      landed: landingResult.landed,
      mergeCommit: landingResult.mergeCommit,
      conflicts: landingResult.conflicts,
      cleanedWisps: landingResult.cleanedWisps
    },
    attribution: landingResult.attribution,
    metadata: {
      processId: 'methodologies/gastown/gastown-convoy',
      attribution: 'https://github.com/steveyegge/gastown',
      author: 'Steve Yegge',
      timestamp: new Date().toISOString()
    }
  };
}
