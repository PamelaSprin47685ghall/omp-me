/**
 * Deterministic URN factory for Squad-Tau session IDs.
 * Format: nodeId::phase::v{epoch}
 * Epoch represents the generation of work (incremented on rejection/reset).
 */
export function sessionIdFor(nodeId, phase, epoch) {
    return `${nodeId}::${phase}::v${epoch || 0}`;
}
