/**
 * Deterministic URN factory for Squad-Tau session IDs.
 * Format: nodeId::phase::v{epoch}
 * Epoch represents the generation of work (incremented on rejection/reset).
 */
export function sessionIdFor(nodeId, _phase, epoch) {
    // Session ID is epoch-stable — no phase component.
    // A single session spans all phases (authoring→confirming→reviewing)
    // within an epoch. Phase transitions do not create new sessions.
    return `${nodeId}::v${epoch || 0}`;
}
