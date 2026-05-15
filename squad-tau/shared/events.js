/**
 * Deterministic URN factory for Squad-Tai session IDs.
 * Format: nodeId::phase::retryCount
 */
export function sessionIdFor(nodeId, phase, retryCount) {
    return `${nodeId}::${phase}::${retryCount}`;
}
