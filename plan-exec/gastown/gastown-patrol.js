/**
 * @process methodologies/gastown/gastown-patrol
 * @description Gas Town Patrol - Continuous monitoring using Deacon/Witness patterns for health checks, stuck agent detection, and recovery
 * @args { townId?: string, patrolInterval?: number, maxCycles?: number, recoveryMode?: string }
 * @outputs { success: boolean, patrolCycles: number, issues: array, recoveries: array, report: object }
 *
 * Attribution: Adapted from https://github.com/steveyegge/gastown by Steve Yegge
 */

async function main(args, task, taskjs) {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const agentMd = await readFile(join(GASTOWN_HOME, 'agents/deacon/AGENT.md'), 'utf-8')
  const as = (task) => `You are acting as the agent defined below. Follow this role definition precisely.\n\n--- AGENT.md START ---\n${agentMd}\n--- AGENT.md END ---\n\nNow execute:\n${task}`

  const townId = args?.townId ?? 'default';
  const patrolInterval = args?.patrolInterval ?? 300;
  const maxCycles = args?.maxCycles ?? 10;
  const recoveryMode = args?.recoveryMode ?? 'reassign';

  const allCycles = [];
  const allRecoveries = [];
  const healthHistory = [];

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    // ========================================================================
    // HEALTH CHECK
    // ========================================================================

    const healthResult = await task(
      as(`Run health check on all agents and convoys in town ${townId} (cycle ${cycle + 1}/${maxCycles})`),
      {
        type: 'object',
        properties: {
          healthy: { type: 'array' },
          unhealthy: { type: 'array' },
          warnings: { type: 'array' },
          systemLoad: { type: 'object' },
          timestamp: { type: 'string' }
        }
      }
    );

    healthHistory.push({
      cycle,
      timestamp: healthResult.timestamp,
      healthy: healthResult.healthy.length,
      unhealthy: healthResult.unhealthy.length,
      warnings: healthResult.warnings.length
    });

    // ========================================================================
    // DETECT STUCK AGENTS
    // ========================================================================

    if (healthResult.unhealthy.length > 0 || healthResult.warnings.length > 0) {
      const stuckResult = await task(
        as(`Detect stuck or unresponsive agents. Unhealthy: ${JSON.stringify(healthResult.unhealthy)}, Warnings: ${JSON.stringify(healthResult.warnings)}`),
        {
          type: 'object',
          properties: {
            stuckAgents: { type: 'array' },
            slowAgents: { type: 'array' },
            diagnostics: { type: 'object' },
            recommendations: { type: 'array' }
          }
        }
      );

      // ====================================================================
      // RECOVERY ACTIONS
      // ====================================================================

      for (const stuckAgent of stuckResult.stuckAgents) {
        const recovery = await task(
          as(`Execute recovery action for stuck agent ${stuckAgent} (mode: ${recoveryMode})`),
          {
            type: 'object',
            properties: {
              recovered: { type: 'boolean' },
              action: { type: 'string' },
              newAgentId: { type: 'string' },
              reassignedBeads: { type: 'array' },
              log: { type: 'string' }
            }
          }
        );

        allRecoveries.push({
          cycle,
          agentId: stuckAgent,
          recovered: recovery.recovered,
          action: recovery.action
        });
      }
    }

    allCycles.push({ cycle, health: healthResult, timestamp: new Date().toISOString() });
  }

  // ============================================================================
  // PATROL REPORT
  // ============================================================================

  const reportResult = await task(
    as(`Generate patrol summary report for town ${townId}`),
    {
      type: 'object',
      properties: {
        report: { type: 'object' },
        overallHealth: { type: 'string' },
        trendAnalysis: { type: 'object' },
        recommendations: { type: 'array' }
      }
    }
  );

  return {
    success: true,
    townId,
    patrolCycles: allCycles.length,
    issues: allRecoveries.filter(r => !r.recovered),
    recoveries: allRecoveries,
    report: reportResult.report,
    healthTrend: reportResult.trendAnalysis,
    metadata: {
      processId: 'methodologies/gastown/gastown-patrol',
      attribution: 'https://github.com/steveyegge/gastown',
      author: 'Steve Yegge',
      timestamp: new Date().toISOString()
    }
  };
}
