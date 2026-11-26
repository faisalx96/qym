/** New run: the checks that turn Start off, the mix, the body of the start call, and the words of a refusal. */
import { describe, expect, it } from 'vitest';
import type {
  PerformanceDataset,
  PerformanceDatasetTiers,
  PerformanceMix,
  PerformanceSetup,
  PerformanceSetupTarget,
  StartRunError,
} from '@/api/performance';
import { performanceSetup } from '@/features/dev/performanceFixtures';
import { ApiError } from '@/lib/http';
import { computePlan } from '../../../lib/plan';
import {
  RUNNER_CODES,
  START_ERROR_CODES,
  refusalCode,
  saveTargetErrorWords,
  saveTokenErrorWords,
  startErrorWords,
} from '../errors';
import { checkTargetForm, type TargetForm } from '../TargetDialog';
import {
  SINGLE_KIND_MIX,
  datasetMix,
  effectiveMix,
  initialDraft,
  mixPresets,
  problemsOf,
  runChecks,
  sampleCounts,
  shiftMix,
  startRequest,
  type CheckInput,
} from '../model';

const USUAL: PerformanceMix = { simple: 50, medium: 35, complex: 15 };

const dataset = (over: Partial<PerformanceDataset> = {}): PerformanceDataset => ({
  id: 'ds-qa',
  name: 'QA - Load questions',
  slug: 'qa-load-questions',
  latest_published_version: { id: 'version-3', name: 'v3' },
  item_count: 139,
  tier_counts: { simple: 30, medium: 38, complex: 71 },
  follow_ups: 133,
  single_kind: false,
  updated_by: 'QA - Person',
  updated_by_user_id: 'user-qa',
  updated_at: '2026-11-12T08:10:00Z',
  ...over,
});

const tiers = (over: Partial<PerformanceDatasetTiers> = {}): PerformanceDatasetTiers => ({
  dataset_id: 'ds-qa',
  dataset_version_id: 'version-3',
  version: 'v3',
  published: true,
  item_count: 139,
  tier_counts: { simple: 30, medium: 38, complex: 71 },
  untiered: 0,
  single_kind: false,
  follow_ups: 133,
  usable: true,
  reason: null,
  ...over,
});

const targetOf = (id: string, over: Partial<PerformanceSetupTarget> = {}): PerformanceSetupTarget => ({
  ...performanceSetup.targets.find((item) => item.id === id)!,
  ...over,
});
const PREPROD = targetOf('target-preprod');

function input(
  over: Omit<Partial<CheckInput>, 'setup'> & { setup?: Partial<PerformanceSetup> } = {},
): CheckInput {
  const setup = { ...performanceSetup, ...over.setup };
  const target = over.target === undefined ? PREPROD : over.target;
  return {
    setup,
    target,
    computed: computePlan('breakpoint', setup.defaults.breakpoint.plan, {
      max_users: target?.max_users,
      max_users_of: target?.name,
      max_total_seconds: setup.limits.max_total_seconds,
    }),
    dataset: over.dataset === undefined ? dataset() : over.dataset,
    tiers: over.tiers ?? tiers(),
    mix: over.mix ?? USUAL,
  };
}

const codes = (over: Parameters<typeof input>[0] = {}) =>
  runChecks(input(over)).map((check) => `${check.tone}:${check.code}`);
const problems = (over: Parameters<typeof input>[0] = {}) =>
  problemsOf(runChecks(input(over))).map((check) => check.code);

describe('the checks that decide whether Start is on', () => {
  it('has no problem for a ready run on a test target, and says the plan is fine', () => {
    expect(problems()).toEqual([]);
    expect(codes()).toEqual(['ok:hold_ok']);
  });

  // Review focus 4: a draft, a kind the mix asks for that is missing, no kinds at all, an empty dataset.
  it('refuses a dataset with no published version, with the reason', () => {
    const checks = runChecks(input({ dataset: dataset({ latest_published_version: null }) }));
    expect(problemsOf(checks)).toEqual([
      {
        code: 'dataset_draft',
        tone: 'bad',
        message:
          'QA - Load questions has no published version. Publish it in Datasets before a run can use it.',
      },
    ]);
  });

  it('refuses a dataset with no questions', () => {
    expect(
      problems({ dataset: dataset({ item_count: 0, tier_counts: { simple: 0, medium: 0, complex: 0 } }) }),
    ).toEqual(['dataset_empty']);
  });

  it('names each kind the mix asks for that the dataset does not have', () => {
    const checks = runChecks(
      input({ dataset: dataset({ item_count: 15, tier_counts: { simple: 0, medium: 0, complex: 15 } }) }),
    );
    expect(problemsOf(checks).map((check) => check.message)).toEqual([
      'The mix asks for 50% simple questions, but QA - Load questions has none. Change the mix or the dataset in step 4.',
      'The mix asks for 35% medium questions, but QA - Load questions has none. Change the mix or the dataset in step 4.',
    ]);
    // A mix of only the kind it has is fine.
    expect(
      problems({
        dataset: dataset({ item_count: 15, tier_counts: { simple: 0, medium: 0, complex: 15 } }),
        mix: { simple: 0, medium: 0, complex: 100 },
      }),
    ).toEqual([]);
  });

  it('runs a dataset without kinds as one kind: a warning, not a problem, and the mix sent is all medium', () => {
    const single = dataset({ single_kind: true, tier_counts: { simple: 0, medium: 0, complex: 0 } });
    expect(codes({ dataset: single, tiers: tiers({ single_kind: true, untiered: 139 }) })).toEqual([
      'warn:dataset_single_kind',
      'ok:hold_ok',
    ]);
    expect(effectiveMix(USUAL, single)).toEqual(SINGLE_KIND_MIX);
    const draft = { ...initialDraft(performanceSetup, PREPROD.id), datasetVersionId: 'version-3' };
    expect(startRequest(draft, single).mix).toEqual({ simple: 0, medium: 100, complex: 0 });
    expect(mixPresets(USUAL, single).find((preset) => preset.key === 'dataset')?.disabled).toBe(true);
  });

  it('takes the reason of the kinds read when the platform says the version cannot be used', () => {
    const checks = runChecks(
      input({ tiers: tiers({ usable: false, reason: 'This version has no questions.' }) }),
    );
    expect(problemsOf(checks)).toEqual([
      { code: 'dataset_unusable', tone: 'bad', message: 'This version has no questions.' },
    ]);
  });

  it('warns about questions without a kind in a dataset that has kinds', () => {
    expect(codes({ tiers: tiers({ untiered: 2 }) })).toContain('warn:dataset_untiered');
  });

  it('asks for a dataset when none is chosen', () => {
    expect(problems({ dataset: null })).toEqual(['dataset_missing']);
  });

  it('blocks only when no start is left this hour: no limit (null) and some left do not', () => {
    const limits = (starts_left: number | null) => ({
      setup: { limits: { ...performanceSetup.limits, starts_left } },
    });
    expect(problems(limits(null))).toEqual([]);
    expect(problems(limits(19))).toEqual([]);
    expect(problems(limits(0))).toEqual(['too_many_starts']);
  });

  it('puts what the platform blocks first, then the other problems, then warnings and what is fine', () => {
    const checks = codes({
      setup: { blocked: { code: 'runner_stale', message: 'The runner has not reported for 6m 12s.' } },
      target: targetOf('target-production', { active_run_id: 'run-0024' }),
      dataset: dataset({ latest_published_version: null }),
    });
    expect(checks).toEqual([
      'bad:runner_stale',
      'bad:sign_in_missing',
      'bad:target_busy',
      'bad:dataset_draft',
      'warn:production',
      'ok:hold_ok',
    ]);
  });

  it('says who may start on production, and that a sign-in ran out', () => {
    const production = targetOf('target-production', { can_start: false });
    expect(
      runChecks(input({ target: production })).find((check) => check.code === 'cannot_start')?.message,
    ).toBe('Only a project manager can start a run on Production, a production target.');
    const expired = targetOf('target-preprod', {
      sign_in_ready: false,
      tokens: PREPROD.tokens.map((token) => ({ ...token, expired: true })),
    });
    expect(
      runChecks(input({ target: expired })).find((check) => check.code === 'sign_in_missing')?.message,
    ).toBe('The saved sign-in of Preprod has run out. Replace the tokens in step 1.');
    expect(problems({ target: null })).toEqual(['target_missing']);
  });

  it('carries a plan problem of the plan rules: a target limit below the plan', () => {
    const small = targetOf('target-preprod', { max_users: 30 });
    expect(problems({ target: small })).toEqual(['over_max_users']);
  });
});

describe('the mix', () => {
  it('always adds up to 100 when one slider moves, whatever the other two were', () => {
    const bases: PerformanceMix[] = [
      USUAL,
      { simple: 100, medium: 0, complex: 0 },
      { simple: 0, medium: 0, complex: 100 },
      { simple: 33, medium: 33, complex: 34 },
      { simple: 1, medium: 2, complex: 97 },
    ];
    for (const base of bases)
      for (const kind of ['simple', 'medium', 'complex'] as const)
        for (const value of [-5, 0, 1, 17, 33.4, 50, 99, 100, 120]) {
          const mix = shiftMix(base, kind, value);
          expect(mix.simple + mix.medium + mix.complex).toBe(100);
          expect(Object.values(mix).every((share) => share >= 0 && share <= 100)).toBe(true);
          expect(mix[kind]).toBe(Math.min(100, Math.max(0, Math.round(value))));
        }
  });

  it('keeps the proportion of the other two kinds', () => {
    expect(shiftMix(USUAL, 'simple', 30)).toEqual({ simple: 30, medium: 49, complex: 21 });
  });

  it('splits a dataset in whole percent that add up to 100', () => {
    expect(datasetMix({ simple: 30, medium: 38, complex: 71 })).toEqual({
      simple: 22,
      medium: 27,
      complex: 51,
    });
    expect(datasetMix({ simple: 0, medium: 0, complex: 0 })).toEqual(SINGLE_KIND_MIX);
  });

  it('offers five ready-made mixes', () => {
    const presets = mixPresets(USUAL, dataset());
    expect(presets.map((preset) => preset.label)).toEqual([
      'Usual mix 50 / 35 / 15',
      'As in the dataset',
      'Simple only',
      'Medium only',
      'Complex only',
    ]);
    expect(presets[1]!.mix).toEqual({ simple: 22, medium: 27, complex: 51 });
  });

  it('shows five sample questions in the proportions of the mix, only of kinds the dataset has', () => {
    expect(sampleCounts(USUAL, { simple: 30, medium: 38, complex: 71 })).toEqual([2, 2, 1]);
    // 35 : 15 of five is 3.5 : 1.5; the tie goes to the first kind.
    expect(sampleCounts(USUAL, { simple: 0, medium: 4, complex: 1 })).toEqual([0, 4, 1]);
    expect(sampleCounts(USUAL, { simple: 0, medium: 0, complex: 0 })).toEqual([0, 0, 0]);
  });
});

describe('the start call', () => {
  it('sends the plan of the chosen test only, and the name of a production target', () => {
    const draft = { ...initialDraft(performanceSetup, 'target-production'), datasetVersionId: 'version-3' };
    const body = startRequest(draft, dataset(), 'Production');
    expect(body).toMatchObject({
      target_id: 'target-production',
      test_type: 'breakpoint',
      dataset_version_id: 'version-3',
      mix: USUAL,
      confirm_target: 'Production',
    });
    expect(body.plan.users).toBeNull();
    expect('confirm_target' in startRequest(draft, dataset())).toBe(false);
  });

  it('opens on the target asked for, else the first test target that can run', () => {
    expect(initialDraft(performanceSetup, 'target-production').targetId).toBe('target-production');
    expect(initialDraft(performanceSetup, 'no-such-target').targetId).toBe('target-playground-17');
  });
});

/** A refusal as the client holds it: the platform's error body. */
const refused = (status: number, code: string, message: string, details: unknown = {}) =>
  new ApiError(status, message, { code, body: { error: { code, message, details } } });

describe('the words of a refusal', () => {
  it('has a sentence for every refusal of the start call, also when the details are missing', () => {
    expect(START_ERROR_CODES).toHaveLength(26);
    for (const code of START_ERROR_CODES) {
      const words = startErrorWords(refused(409, code, `server sentence for ${code}`, []));
      expect(words, code).not.toMatch(/undefined|null|NaN|\[object/);
      expect(words.length, code).toBeGreaterThan(20);
    }
  });

  it('says what to do, with the numbers the platform sent', () => {
    const cases: [StartRunError['code'], number, unknown, string][] = [
      [
        'runner_busy',
        409,
        { run_id: 'run-0024' },
        'The runner is busy with another run. Wait for that run to end, or stop it, then start again.',
      ],
      [
        'target_busy',
        409,
        { run_id: 'run-0024' },
        'A run is already queued or running on this target. Wait for it to end, or stop it, then start again.',
      ],
      ['target_archived', 409, {}, 'This target was archived. Choose another target in step 1.'],
      ['access_denied', 403, {}, 'You are not a member of this project. Ask a project manager to add you.'],
      [
        'runner_stale',
        409,
        { seconds_since_heartbeat: 372 },
        'The runner has not reported for 6m 12s. Check that it is running (see the Runner page), then start again.',
      ],
      [
        'over_target_limit',
        422,
        { field: 'max_users', limit: 30, value: 60 },
        'This target allows at most 30 users. This is 60. Lower the load in step 3.',
      ],
      [
        'mix_tier_empty',
        409,
        { tiers: ['simple', 'medium', 'complex'] },
        'The mix asks for simple, medium and complex questions, but the dataset has none of them. Change the mix or the dataset in step 4.',
      ],
      [
        'too_many_starts',
        429,
        { retry_after_s: 600 },
        'You have started the most runs allowed in an hour. Try again in 10m.',
      ],
      [
        'sign_in_missing',
        409,
        { missing: ['refresh_token'] },
        'No sign-in is saved for this target (missing: refresh token). Paste the tokens in step 1.',
      ],
    ];
    for (const [code, status, details, words] of cases)
      expect(startErrorWords(refused(status, code, 'server sentence', details)), code).toBe(words);
  });

  it('takes the first problem of an invalid plan, from all the checks the platform sends', () => {
    const checks = [
      { code: 'hold_ok', tone: 'ok', message: 'Each level is held 7m 30s.' },
      { code: 'hold_short', tone: 'bad', message: 'Each level is held 1m, shorter than the 180s limit.' },
    ];
    expect(startErrorWords(refused(422, 'plan_invalid', 'Plan is not valid', { checks }))).toBe(
      'Each level is held 1m, shorter than the 180s limit. Change the load in step 3.',
    );
  });

  it('keeps the platform’s sentence for a code it does not know, and says when nothing answered', () => {
    expect(startErrorWords(refused(409, 'something_new', 'Something new happened.'))).toBe(
      'Something new happened.',
    );
    expect(startErrorWords(new TypeError('Failed to fetch'))).toBe(
      'The platform did not answer. Check the connection and try again.',
    );
  });

  it('words the refusals of saving a target and a token', () => {
    expect(saveTargetErrorWords(refused(409, 'target_address_taken', 'taken', { name: 'Preprod' }))).toBe(
      'Preprod already uses this address. Change the address, or edit that target.',
    );
    expect(saveTokenErrorWords(refused(422, 'token_empty', 'empty'))).toBe(
      'The token is empty. Paste it again.',
    );
    expect(saveTokenErrorWords(refused(409, 'target_busy', 'busy', { run_id: 'run-0024' }))).toMatch(
      /^A run is queued or running on this target\./,
    );
  });

  it('words the two refusals of a start that came with the review fixes', () => {
    const mismatch = refused(409, 'runner_key_mismatch', 'The runner connected with another API key.');
    expect(startErrorWords(mismatch)).toBe(
      'The runner is using a different API key than the one chosen for it. Restart the runner with the chosen key, or a project manager chooses its key on the Runner page.',
    );
    // Fixed on the Runner page: the page links to it.
    expect(RUNNER_CODES.has(refusalCode(mismatch))).toBe(true);
    const changed = refused(409, 'target_changed', 'Target changed', { target_id: 'target-preprod' });
    expect(startErrorWords(changed)).toBe(
      'This target was changed while the run was starting. Check its address and sign-in in step 1, then start again.',
    );
    expect(RUNNER_CODES.has(refusalCode(changed))).toBe(false);
    expect(refusalCode(new TypeError('Failed to fetch'))).toBe('');
  });
});

describe('the target dialog', () => {
  const form = (over: Partial<TargetForm> = {}): TargetForm => ({
    name: PREPROD.name,
    address: PREPROD.base_url,
    chatPath: PREPROD.chat_path,
    tokenPath: PREPROD.token_refresh_path,
    maxUsers: Number.NaN,
    production: false,
    authServer: PREPROD.settings.auth_server ?? '',
    cookieName: PREPROD.settings.refresh_cookie_name,
    maxDurationMinutes: Number.NaN,
    ...over,
  });
  const warnings = (over: Partial<TargetForm>, target: PerformanceSetupTarget = PREPROD) =>
    checkTargetForm(form(over), { target, targets: performanceSetup.targets }).warnings;

  it.each([
    'http://chat',
    'http://10.0.0.1',
    'http://[fd12::1]:8080',
    'http://metadata',
    'http://chat/path',
    'http://chat:0',
  ])('leaves address validation to the backend and preserves %s', (address) => {
    expect(checkTargetForm(form({ address }))).toMatchObject({ ok: true, baseUrl: address });
  });

  it('accepts empty or whole-minute durations and rejects fractional minutes', () => {
    for (const maxDurationMinutes of [Number.NaN, 1, 15])
      expect(checkTargetForm(form({ maxDurationMinutes })).ok).toBe(true);
    for (const maxDurationMinutes of [0, -1, 1.5])
      expect(checkTargetForm(form({ maxDurationMinutes })).durationError).toMatch(/whole minutes/);
  });

  it('says before saving that a new address or renewal path removes the saved sign-in', () => {
    expect(warnings({})).toEqual([]);
    expect(warnings({ name: 'Preprod 2', chatPath: '/other/chat' })).toEqual([]);
    expect(warnings({ tokenPath: '/auth/renew' })).toEqual([
      'The sign-in renewal path changes, so the saved sign-in of this target is cleared. Paste the tokens again after saving.',
    ]);
    expect(warnings({ address: 'https://insightor.ingress.preprod2.example.org' })).toEqual([
      'The address changes, so the saved sign-in of this target is cleared. Paste the tokens of the new address after saving.',
    ]);
    // Nothing to lose when no token is saved.
    expect(warnings({ tokenPath: '/auth/renew' }, { ...PREPROD, tokens: [] })).toEqual([]);
  });
});
