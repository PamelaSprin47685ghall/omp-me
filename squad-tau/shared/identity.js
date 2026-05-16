/**
 * URN Identity Protocol — deterministic, scoped, cryptofree.
 *
 * Formula: urn:squad:node:{nodeId}:v{epoch}
 *
 * Invariants:
 *  - No phase/state words (authoring, reviewing, etc.) in the URN.
 *  - epoch is a monotonically increasing integer reflecting work generation.
 *  - A Node in one attempt (epoch) is a single identity regardless of phase.
 */
const URN_RE = /^urn:squad:node:([^:]+):v(\d+)$/;

export function toURN(nodeId, epoch) {
    return `urn:squad:node:${nodeId}:v${epoch}`;
}

export function fromURN(urn) {
    const m = URN_RE.exec(urn);
    if (!m) throw new Error(`[Identity] Invalid URN: ${urn}`);
    return { nodeId: m[1], epoch: parseInt(m[2], 10) };
}

/** Session-level identity — phase-index encoded, no state words in the string. */
/** Session-level identity — phase-index encoded, no state words in the string. */
const SESS_PHASES = ['authoring', 'confirming', 'reviewing'];
export function sessionURN(nodeId, epoch, phase) {
    const pi = SESS_PHASES.indexOf(phase);
    if (pi === -1) throw new Error(`[Identity] Unknown phase: ${phase}`);
    return `urn:squad:session:${nodeId}:v${epoch}:p${pi}`;
}

/** Parse a session URN back into its components.
 *  Returns { nodeId, epoch, phase, phaseIndex }.
 *  Throws on malformed input.
 */
const SESS_URN_RE = /^urn:squad:session:([^:]+):v(\d+):p(\d+)$/;
export function fromSessionURN(urn) {
    const m = SESS_URN_RE.exec(urn);
    if (!m) throw new Error(`[Identity] Invalid session URN: ${urn}`);
    const nodeId = m[1];
    const epoch = parseInt(m[2], 10);
    const pi = parseInt(m[3], 10);
    const phase = SESS_PHASES[pi];
    if (!phase) throw new Error(`[Identity] Unknown phase index ${pi} in URN: ${urn}`);
    return { nodeId, epoch, phase, phaseIndex: pi };
}
