/**
 * Single source of truth for timeouts.
 * T = 1000ms — every timeout in every test.
 * Changing this breaks ALL tests' latency assumptions.
 */
export const T = 1000;
