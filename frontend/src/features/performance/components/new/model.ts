/**
 * New run: what the person has set so far, the words that describe it, and the checks that decide whether
 * Start is on. No React here: the steps render what these functions return.
 */
import type {
  PerformanceCheckTone,
  PerformanceDataset,
  PerformanceDatasetTiers,
  PerformanceMix,
  PerformancePlanInput,
  PerformanceSetup,
  PerformanceSetupTarget,
  PerformanceTestType,
  PerformanceTier,
  StartRunRequest,
} from '@/api/performance';
import { KINDS, count, span } from '../../lib/format';
import { expectedAnswers, normalizePlanInput, type ComputedPlan } from '../../lib/plan';

export type StepNumber = 1 | 2 | 3 | 4 | 5;

export const STEPS: { id: string; label: string; about: string }[] = [
  {
    id: 'target',
    label: 'Target and sign-in',
    about: 'Where the questions are sent, and the sign-in the run uses.',
  },
  { id: 'test', label: 'Test', about: 'What the run should find out.' },
  {
    id: 'load',
    label: 'Load',
    about: 'How far to raise the number of users, and when a level counts as broken.',
  },
  {
    id: 'questions',
    label: 'Questions',
    about: 'The dataset the questions come from, and how they are mixed.',
  },
  { id: 'review', label: 'Review and start', about: 'Check the plan. Nothing runs until you confirm.' },
];

const LOAD_ABOUT: Record<PerformanceTestType, string> = {
  breakpoint: STEPS[2]!.about,
  smoke: 'Fixed for this test.',
  soak: 'How many users, and for how long.',
};

/** The one-line description of a step; the Load step's follows the test. */
export const stepAbout = (step: StepNumber, test: PerformanceTestType) =>
  step === 3 ? LOAD_ABOUT[test] : STEPS[step - 1]!.about;

export const TESTS: { key: PerformanceTestType; name: string; line: string; usual: string; shape: string }[] =
  [
    {
      key: 'breakpoint',
      name: 'Breakpoint',
      line: 'Find how many users the system takes before it gets too slow or starts failing.',
      usual: 'Users go up in steps · usually about 50 minutes',
      shape: 'M2 19h9v-4h9v-4h9v-4h9v-4h16',
    },
    {
      key: 'smoke',
      name: 'Smoke',
      line: 'One user for 3 minutes. Checks sign-in and that real answers come back. Run it first.',
      usual: '1 user · usually 3 minutes',
      shape: 'M2 17h12',
    },
    {
      key: 'soak',
      name: 'Soak',
      line: 'Steady load for hours. Shows whether answers get slower over time.',
      usual: '20 users, steady · usually 2 hours',
      shape: 'M2 9h52',
    },
  ];

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- the draft ----------

/** What the person has set. One plan per test, so going from one test to another and back loses nothing. */
export interface NewRunDraft {
  targetId: string | null;
  test: PerformanceTestType;
  plans: Record<PerformanceTestType, PerformancePlanInput>;
  /** The answer timeout follows the time limit until the person sets it. */
  timeoutEdited: boolean;
  datasetVersionId: string | null;
  mix: PerformanceMix;
  /** The mix follows the test's usual mix until the person sets it. */
  mixEdited: boolean;
}

/** The target the page opens with: the one asked for, else the first that can run right away. */
export function defaultTargetId(targets: PerformanceSetupTarget[], wanted?: string | null): string | null {
  if (wanted && targets.some((target) => target.id === wanted)) return wanted;
  const ready = targets.find((target) => !target.is_production && target.sign_in_ready);
  return (ready ?? targets.find((target) => !target.is_production) ?? targets[0])?.id ?? null;
}

export function initialDraft(setup: PerformanceSetup, wantedTarget?: string | null): NewRunDraft {
  return {
    targetId: defaultTargetId(setup.targets, wantedTarget),
    test: 'breakpoint',
    plans: {
      breakpoint: { ...setup.defaults.breakpoint.plan },
      smoke: { ...setup.defaults.smoke.plan },
      soak: { ...setup.defaults.soak.plan },
    },
    timeoutEdited: false,
    datasetVersionId: null,
    mix: { ...setup.defaults.breakpoint.mix },
    mixEdited: false,
  };
}

// ---------- the mix ----------

export const SINGLE_KIND_MIX: PerformanceMix = { simple: 0, medium: 100, complex: 0 };

export const sameMix = (a: PerformanceMix, b: PerformanceMix) => KINDS.every((kind) => a[kind] === b[kind]);

/** '50% simple, 35% medium, 15% complex'; a kind at 0 is left out. */
export const mixWords = (mix: PerformanceMix) =>
  KINDS.filter((kind) => mix[kind] > 0)
    .map((kind) => `${mix[kind]}% ${kind}`)
    .join(', ');

/** The dataset's own split in whole percent that add up to 100 (largest remainders get the rest). */
export function datasetMix(counts: Record<PerformanceTier, number>): PerformanceMix {
  const total = KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  if (!total) return { ...SINGLE_KIND_MIX };
  const exact = KINDS.map((kind) => (counts[kind] * 100) / total);
  const whole = exact.map(Math.floor);
  const rest = 100 - whole.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => [value - whole[index]!, index] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, rest)
    .forEach(([, index]) => {
      whole[index]! += 1;
    });
  return { simple: whole[0]!, medium: whole[1]!, complex: whole[2]! };
}

/**
 * One kind set to a value; the other two share the rest in the proportion they had in `base` (the mix when
 * the drag began), so the three always add up to 100.
 */
export function shiftMix(base: PerformanceMix, kind: PerformanceTier, value: number): PerformanceMix {
  const [first, second] = KINDS.filter((other) => other !== kind) as [PerformanceTier, PerformanceTier];
  const share = Math.min(100, Math.max(0, Math.round(value)));
  const rest = 100 - share;
  const a = base[first];
  const b = base[second];
  const firstShare = a + b ? Math.round((rest * a) / (a + b)) : Math.round(rest / 2);
  return { ...base, [kind]: share, [first]: firstShare, [second]: rest - firstShare };
}

export interface MixPreset {
  key: string;
  label: string;
  mix: PerformanceMix;
  disabled?: boolean;
}

/** The five ready-made mixes. "As in the dataset" needs a dataset that has kinds. */
export function mixPresets(usual: PerformanceMix, dataset: PerformanceDataset | null): MixPreset[] {
  const only = (kind: PerformanceTier): PerformanceMix => ({ simple: 0, medium: 0, complex: 0, [kind]: 100 });
  const own = dataset && !dataset.single_kind && dataset.item_count > 0;
  return [
    { key: 'usual', label: `Usual mix ${usual.simple} / ${usual.medium} / ${usual.complex}`, mix: usual },
    {
      key: 'dataset',
      label: 'As in the dataset',
      mix: own ? datasetMix(dataset.tier_counts) : usual,
      disabled: !own,
    },
    { key: 'simple', label: 'Simple only', mix: only('simple') },
    { key: 'medium', label: 'Medium only', mix: only('medium') },
    { key: 'complex', label: 'Complex only', mix: only('complex') },
  ];
}

/** The mix a run on this dataset really uses: a dataset without kinds is asked as one kind. */
export const effectiveMix = (mix: PerformanceMix, dataset: PerformanceDataset | null) =>
  dataset?.single_kind ? SINGLE_KIND_MIX : mix;

/** Five sample questions that follow the mix: how many of each kind (largest remainders get the rest). */
export function sampleCounts(
  mix: PerformanceMix,
  available: Record<PerformanceTier, number>,
  total = 5,
): number[] {
  const want = KINDS.map((kind) => (available[kind] ? mix[kind] : 0));
  const sum = want.reduce((a, b) => a + b, 0);
  if (!sum) return [0, 0, 0];
  const exact = want.map((value) => (value * total) / sum);
  const whole = exact.map(Math.floor);
  exact
    .map((value, index) => [value - whole[index]!, index] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, total - whole.reduce((a, b) => a + b, 0))
    .forEach(([, index]) => {
      whole[index]! += 1;
    });
  return whole;
}

// ---------- the plan in words ----------

/** 1718 -> 'about 1,700': rounded so the number does not claim more than the estimate knows. */
export function aboutCount(value: number): string {
  const rounded =
    value >= 1000
      ? Math.round(value / 100) * 100
      : value >= 100
        ? Math.round(value / 10) * 10
        : Math.round(value);
  return `about ${count(rounded)}`;
}

/**
 * '10, 20, 30, 40, 50, 60 users'; a long ladder in words, '5 to 200 users, in steps of 5' (no ellipsis: labels and
 * sentences carry no "…"). The levels are the step, twice the step and so on, so a ladder is even.
 */
export function levelUsers(levels: number[]): string {
  if (levels.length <= 8) return `${levels.join(', ')} users`;
  const first = levels[0]!;
  return `${first} to ${levels[levels.length - 1]} users, in steps of ${levels[1]! - first}`;
}

const seconds = (ms: number) => `${Number((ms / 1000).toFixed(3))}s`;

export interface PlanWords {
  /** 'Load' of the summary and the review. */
  load: string;
  /** 'Levels' of the Start dialog. */
  levels: string;
  /** The short list under the Levels number. */
  levelsShort: string;
  limits: string;
  also: string;
  length: string;
  answers: string;
}

export function planWords(test: PerformanceTestType, computed: ComputedPlan): PlanWords {
  const { plan, levels } = computed;
  const users = plan.users ?? 1;
  const hold = span(plan.hold_seconds ?? 0);
  const within = `95% of answers within ${seconds(plan.limit_ms)}, errors under ${plan.max_error_rate_pct}%.`;
  const timeout = `Answer timeout ${plan.timeout_seconds}s.`;
  const common = { length: span(plan.total_seconds), answers: aboutCount(expectedAnswers(plan)) };
  if (test === 'breakpoint') {
    const some = levels.length > 0;
    return {
      ...common,
      load: some
        ? `${levels[0]} to ${levels[levels.length - 1]} users in steps of ${plan.step_users}, each held ${hold}`
        : 'No level would be measured',
      levels: some ? `${levelUsers(levels)} (${plural(levels.length, 'level')}, ${hold} each)` : 'None',
      levelsShort: some ? levelUsers(levels) : 'no level is measured',
      limits: `${within} ${plan.abort_on_break ? 'Stops at the first level that breaks.' : 'Measures every level.'}`,
      also: `A follow-up in ${Math.round((plan.follow_up_rate ?? 0) * 100)}% of conversations. ${timeout}`,
    };
  }
  const steady =
    test === 'smoke' ? '1 user for 3 minutes' : `${plural(users, 'user')}, steady, for ${common.length}`;
  return {
    ...common,
    load: steady,
    levels: test === 'smoke' ? '1 user, no steps' : `${plural(users, 'user')}, steady, no steps`,
    levelsShort: 'steady, no steps',
    limits: within,
    also: timeout,
  };
}

// ---------- the checks ----------

export interface RunCheck {
  code: string;
  tone: PerformanceCheckTone;
  message: string;
}

export interface CheckInput {
  setup: PerformanceSetup;
  target: PerformanceSetupTarget | null;
  computed: ComputedPlan;
  /** The chosen dataset: its row of the list; null when none is chosen (or it is no longer listed). */
  dataset: PerformanceDataset | null;
  /** The detail read of the chosen version, when it has arrived. */
  tiers?: PerformanceDatasetTiers | null;
  mix: PerformanceMix;
}

const ORDER: Record<PerformanceCheckTone, number> = { bad: 0, warn: 1, ok: 2 };

/**
 * Every check of the run, problems first, then warnings, then what is fine: the runner and the platform,
 * the target and its sign-in, the plan against its limits, the dataset and the mix. One 'bad' check turns
 * Start off. The start route checks the same things again: these only tell the person before pressing.
 */
export function runChecks({ setup, target, computed, dataset, tiers, mix }: CheckInput): RunCheck[] {
  const checks: RunCheck[] = [];
  const add = (code: string, tone: PerformanceCheckTone, message: string) =>
    checks.push({ code, tone, message });

  if (setup.blocked) add(setup.blocked.code, 'bad', setup.blocked.message);
  if (setup.limits.starts_left === 0)
    add(
      'too_many_starts',
      'bad',
      `You have started ${setup.limits.starts_per_hour} runs in the last hour, the most allowed. Try again later.`,
    );

  if (!target) {
    add(
      'target_missing',
      'bad',
      setup.targets.length
        ? 'No target is chosen. Choose one in step 1.'
        : 'This project has no target yet. A project manager adds one in step 1.',
    );
  } else {
    if (!target.can_start)
      add(
        'cannot_start',
        'bad',
        target.is_production
          ? `Only a project manager can start a run on ${target.name}, a production target.`
          : 'You may not start runs in this project. Ask a project manager for the Member role.',
      );
    const refresh = target.tokens.find((token) => token.name === 'refresh_token');
    if (!target.sign_in_ready)
      add(
        'sign_in_missing',
        'bad',
        refresh?.expired
          ? `The saved sign-in of ${target.name} has run out. Replace the tokens in step 1.`
          : `No sign-in is saved for ${target.name}. Paste the tokens in step 1.`,
      );
    if (target.active_run_id)
      add(
        'target_busy',
        'bad',
        `A run is already queued or running on ${target.name}. Wait for it to end, or stop it first.`,
      );
    if (target.is_production)
      add(
        'production',
        'warn',
        'This puts real load on production. You will be asked to type the name of the target.',
      );
  }

  checks.push(...computed.checks);

  if (!dataset) {
    add('dataset_missing', 'bad', 'No dataset is chosen. Choose one in step 4.');
  } else {
    const name = dataset.name;
    if (!dataset.latest_published_version)
      add(
        'dataset_draft',
        'bad',
        `${name} has no published version. Publish it in Datasets before a run can use it.`,
      );
    else if (dataset.item_count <= 0)
      add('dataset_empty', 'bad', `${name} has no questions. Add questions in Datasets, or choose another.`);
    else if (tiers && !tiers.usable)
      add('dataset_unusable', 'bad', tiers.reason ?? `${name} cannot be used for a run.`);
    else if (dataset.single_kind)
      add(
        'dataset_single_kind',
        'warn',
        `${name} has no kinds: all its questions are asked as one kind, and the mix is not used.`,
      );
    else {
      const missing = KINDS.filter((kind) => mix[kind] > 0 && !dataset.tier_counts[kind]);
      for (const kind of missing)
        add(
          'mix_tier_empty',
          'bad',
          `The mix asks for ${mix[kind]}% ${kind} questions, but ${name} has none. Change the mix or the dataset in step 4.`,
        );
      if (tiers && tiers.untiered > 0)
        add(
          'dataset_untiered',
          'warn',
          `${plural(tiers.untiered, 'question')} of ${name} ${tiers.untiered === 1 ? 'has' : 'have'} no kind and will not be asked.`,
        );
    }
  }
  return checks
    .map((item, index) => [item, index] as const)
    .sort((a, b) => ORDER[a[0].tone] - ORDER[b[0].tone] || a[1] - b[1])
    .map(([item]) => item);
}

export const problemsOf = (checks: RunCheck[]) => checks.filter((item) => item.tone === 'bad');

// ---------- the request ----------

/** The body of the start call for what the person set. */
export function startRequest(
  draft: NewRunDraft,
  dataset: PerformanceDataset | null,
  confirmTarget?: string,
): StartRunRequest {
  return {
    target_id: draft.targetId ?? '',
    test_type: draft.test,
    dataset_version_id: draft.datasetVersionId ?? '',
    plan: normalizePlanInput(draft.test, draft.plans[draft.test]),
    mix: effectiveMix(draft.mix, dataset),
    ...(confirmTarget === undefined ? {} : { confirm_target: confirmTarget }),
  };
}
