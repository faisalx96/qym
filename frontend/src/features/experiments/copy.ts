/** Strings shared by the experiments list and the queue (WP-B, spec-b section 8). */
export const LATENCY_FILTER_LABEL = 'Latency-sensitive only';
/** The note under an environment card while a latency-sensitive job is active there. */
export const queueLatencyNote = (environment: string): string =>
  `A latency-sensitive job is active on ${environment}. Other jobs wait until it finishes.`;
