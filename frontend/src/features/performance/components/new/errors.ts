/**
 * New run: every refusal of the start call, of saving a target and of saving a token, in words a person can
 * act on. A code this file does not know keeps the sentence the API sent.
 */
import {
  performanceError,
  type PerformanceTokenName,
  type SaveTargetError,
  type SaveTargetTokenError,
  type StartRunError,
} from '@/api/performance';
import { formatTableDate } from '@/lib/dates';
import { span } from '../../lib/format';

type Words<E extends { code: string }> = { [C in E['code']]: (error: Extract<E, { code: C }>) => string };

const NO_ANSWER = 'The platform did not answer. Check the connection and try again.';
const TOKEN_NAME: Record<PerformanceTokenName, string> = {
  refresh_token: 'refresh token',
  access_token: 'access token',
};

const invalid = (error: { details: unknown; message: string }) => {
  const first = Array.isArray(error.details) ? (error.details[0] as { loc?: unknown[]; msg?: string }) : null;
  const where = first?.loc?.filter((part) => part !== 'body').join(' › ');
  return first?.msg
    ? `A setting was not accepted${where ? ` (${where})` : ''}: ${first.msg}. Change it and try again.`
    : error.message;
};

const overLimit = (
  owner: string,
  error: { message: string; details?: { field?: string; limit?: number; value?: number } },
  fix: string,
) => {
  const { field, limit, value } = error.details ?? {};
  if (typeof limit !== 'number' || typeof value !== 'number') return `${error.message} ${fix}`;
  return field === 'max_users'
    ? `${owner} allows at most ${limit} users. This is ${value}. ${fix}`
    : `${owner} allows at most ${span(limit)}. This is ${span(value)}. ${fix}`;
};

/** 'simple', 'simple and medium', 'simple, medium and complex'. */
const listWords = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] ?? '');

const NOT_A_MEMBER = 'You are not a member of this project. Ask a project manager to add you.';

const START: Words<StartRunError> = {
  access_denied: () => NOT_A_MEMBER,
  forbidden: () => 'You may not start runs in this project. Ask a project manager for the Member role.',
  production_requires_manager: () => 'Only a project manager can start a run on a production target.',
  target_not_found: () => 'This target no longer exists. Choose another target in step 1.',
  target_archived: () => 'This target was archived. Choose another target in step 1.',
  runner_missing: () =>
    'No runner is connected to this project. Connect one (see the Runner page), then start again.',
  runner_stale: (e) =>
    e.details?.seconds_since_heartbeat == null
      ? 'The runner is not reporting. Check that it is running (see the Runner page), then start again.'
      : `The runner has not reported for ${span(e.details.seconds_since_heartbeat)}. Check that it is running (see the Runner page), then start again.`,
  runner_key_missing: () =>
    'No API key is chosen for the runner. A project manager chooses it on the Runner page.',
  runner_key_mismatch: () =>
    'The runner is using a different API key than the one chosen for it. Restart the runner with the chosen key, or a project manager chooses its key on the Runner page.',
  runner_busy: () =>
    'The runner is busy with another run. Wait for that run to end, or stop it, then start again.',
  target_busy: () =>
    'A run is already queued or running on this target. Wait for it to end, or stop it, then start again.',
  target_changed: () =>
    'This target was changed while the run was starting. Check its address and sign-in in step 1, then start again.',
  encryption_key_missing: () =>
    'Sign-in tokens cannot be stored on this platform yet: its encryption key is not set. Ask the platform administrator.',
  sign_in_missing: (e) => {
    const missing = (e.details?.missing ?? []).map((name) => TOKEN_NAME[name] ?? name).join(' and ');
    return `No sign-in is saved for this target${missing ? ` (missing: ${missing})` : ''}. Paste the tokens in step 1.`;
  },
  token_expired: (e) =>
    `The saved ${TOKEN_NAME[e.details?.name] ?? 'token'} ran out${e.details?.expires_at ? ` on ${formatTableDate(e.details.expires_at)}` : ''}. Replace the tokens in step 1.`,
  dataset_not_found: () => 'This dataset version no longer exists. Choose another dataset in step 4.',
  dataset_not_published: () =>
    'This dataset version is not published. Publish it in Datasets, or choose another dataset in step 4.',
  dataset_not_allowed: (e) =>
    e.details?.reason === 'private_test_set'
      ? 'This dataset is a private test set and cannot be used for a load test. Choose another dataset in step 4.'
      : 'Access to this dataset is restricted, so a load test cannot use it. Choose another dataset in step 4.',
  mix_invalid: (e) =>
    `The mix adds up to ${e.details?.sum ?? 'another number than 100'}%, not 100%. Change it in step 4.`,
  mix_tier_empty: (e) =>
    `The mix asks for ${listWords(e.details?.tiers ?? []) || 'a kind of'} questions, but the dataset has none of them. Change the mix or the dataset in step 4.`,
  plan_invalid: (e) => {
    const checks = e.details?.checks ?? [];
    const first = checks.find((check) => check.tone === 'bad') ?? checks[0];
    return first
      ? `${first.message} Change the load in step 3.`
      : 'The plan was not accepted. Check the load in step 3.';
  },
  over_target_limit: (e) => overLimit('This target', e, 'Lower the load in step 3.'),
  over_platform_limit: (e) => overLimit('The platform', e, 'Lower the load in step 3.'),
  confirm_target_mismatch: () => 'The name typed is not the name of the target. Type it exactly as shown.',
  too_many_starts: (e) =>
    `You have started the most runs allowed in an hour.${e.details?.retry_after_s ? ` Try again in ${span(e.details.retry_after_s)}.` : ' Try again later.'}`,
  validation: invalid,
};

const SAVE_TARGET: Words<SaveTargetError> = {
  access_denied: () => NOT_A_MEMBER,
  target_archived: () => 'This target was archived. Restore it in the Targets list before changing it.',
  forbidden: () => 'Only a project manager can add or change a target.',
  target_not_found: () => 'This target no longer exists. Close the dialog and choose another.',
  target_name_taken: () => 'Another target already has this name. Choose another name.',
  target_address_taken: (e) =>
    `${e.details?.name ?? 'Another target'} already uses this address. Change the address, or edit that target.`,
  target_busy: () => 'A run is queued or running on this target. Wait for it to end, or stop it, then save.',
  over_platform_limit: (e) => overLimit('The platform', e, 'Enter a lower limit.'),
  validation: invalid,
};

const SAVE_TOKEN: Words<SaveTargetTokenError> = {
  access_denied: () => NOT_A_MEMBER,
  target_archived: () => 'This target was archived. Choose another target.',
  target_busy: () =>
    'A run is queued or running on this target. Its tokens can be replaced when the run has ended; a run that waits for a token asks for it on its own page.',
  forbidden: () => 'You may not save tokens in this project. Ask a project manager for the Member role.',
  production_requires_manager: () => 'Only a project manager can save the sign-in of a production target.',
  target_not_found: () => 'This target no longer exists. Choose another target.',
  encryption_key_missing: () =>
    'Tokens cannot be stored on this platform yet: its encryption key is not set. Ask the platform administrator.',
  token_empty: () => 'The token is empty. Paste it again.',
  validation: invalid,
};

function words<E extends { code: string; message: string }>(table: Words<E>, error: unknown): string {
  const refused = performanceError<E & { status: number; details: unknown }>(error);
  if (!refused) return NO_ANSWER;
  const say = (table as unknown as Record<string, ((e: E) => string) | undefined>)[refused.code];
  return say ? say(refused) : refused.message;
}

/** Why the run was not started, and what to do about it. */
export const startErrorWords = (error: unknown) => words(START, error);
/** Refusals that are fixed on the Runner page: the page shows a link to it beside the words. */
export const RUNNER_CODES: ReadonlySet<string> = new Set([
  'runner_missing',
  'runner_stale',
  'runner_key_missing',
  'runner_key_mismatch',
]);
/** The code of a refusal, or '' when nothing answered. */
export const refusalCode = (error: unknown) =>
  performanceError<{ status: number; code: string; message: string; details: unknown }>(error)?.code ?? '';
/** Why the target was not saved. */
export const saveTargetErrorWords = (error: unknown) => words(SAVE_TARGET, error);
/** Why the token was not saved. */
export const saveTokenErrorWords = (error: unknown) => words(SAVE_TOKEN, error);

/** Every code the start call refuses with: the test walks this list. */
export const START_ERROR_CODES = Object.keys(START) as StartRunError['code'][];
