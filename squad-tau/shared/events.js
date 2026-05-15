export function sessionIdFor(nodeId, phase, retryCount) {
    return `${nodeId}::${phase}::${retryCount}`;
}
