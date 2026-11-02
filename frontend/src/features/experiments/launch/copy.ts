/**
 * Every user-facing string of the launch form's latency-sensitive and dataset-token additions
 * (WP-B, spec-b.md section 8), in one place so the components, the tests and the reviewer compare
 * one source. Sentences, no exclamation marks, numbers in the sentence.
 */

export const LATENCY_LABEL = 'Latency-sensitive run';
export const LATENCY_HELPER =
  'Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.';
export const LATENCY_CALLOUT_TITLE = 'Other jobs wait while this run executes';
export const LATENCY_REVIEW_LABEL = 'Latency-sensitive';
export const LATENCY_REVIEW_VALUE = 'yes';

/** `Only a project manager can launch it on production. Clear the box or ask a project manager.` */
export const latencyCalloutBody = (names: readonly string[]): string =>
  `Only a project manager can launch it on ${names.join(', ')}. Clear the box or ask a project manager.`;
/** The reason the checkbox is disabled (every selected environment is managers-only). */
export const latencyDisabledReason = (names: readonly string[]): string =>
  `Only project managers can launch latency-sensitive runs on ${names.join(', ')}.`;
/** The 403 text and the blocking review item. */
export const latencyGateMessage = (names: readonly string[]): string =>
  `Latency-sensitive runs on ${names.join(', ')} need a project manager`;

export const CEILING_WARNING_TITLE = 'Post-run ceiling not set';
export const CEILING_WARNING_ACTION = 'Set ceiling';
export const TOKEN_WARNING_TITLE = 'Dataset read token will not be sent';
export const CEILING_POINTER = '/env_overrides/EVAL_VLLM_POST_RUN_MAX_REQUESTS';

export const DATASET_CHIP_RESTRICTED = 'Restricted';
export const DATASET_CHIP_PRIVATE = 'Private test set';
export const DATASET_HELP_RESTRICTED =
  'Restricted dataset. The experiment reads it with its own dataset read token; people without access to the dataset see this run’s scores, not its item contents.';
export const DATASET_HELP_PRIVATE =
  'Private test set. The experiment reads it with its own dataset read token; only admins see its item contents.';
