import { describe, expect, it } from 'vitest';
import { makeCtx, makeEnv, PRODUCTION, STAGING, twoEnvCtx } from './__fixtures__/fixtures';
import { setBinding } from './bindings';
import { createDocument } from './document';
import { addMetaRow, setConfigInput, updateMetaRow, metaRowsOf } from './evaluator';
import { evaluatorPanel } from './__fixtures__/fixtures';
import { setLeafInput, setValue } from './layering';
import { pointerToFieldName } from './pointers';
import {
  highWarnings,
  launchLabel,
  locate,
  localErrors,
  mapServerErrors,
  maxPriority,
  normalizePriority,
  parseLaunchFailure,
  priorityOptions,
  reviewState,
  runCount,
  validationItems,
  visibleServerErrors,
} from './validation';
import type { DryRunResponse, LaunchDocument, ServerError } from './types';

const ctx = makeCtx();

function valid(extra: Partial<LaunchDocument> = {}): LaunchDocument {
  return createDocument({
    environmentIds: [PRODUCTION],
    name: 'run',
    dataset: { mode: 'project', name: 'support-qa', ref: '', custom: '' },
    base: { ...createDocument().base, kind: 'scratch', loaded: true },
    ...extra,
  });
}

describe('local errors', () => {
  it('has none for a complete document', () => {
    expect(localErrors(valid(), ctx)).toEqual([]);
  });

  it('requires environments, a dataset and a name', () => {
    const items = localErrors(createDocument(), makeCtx({ envs: [] }));
    expect(items.map((i) => [i.pointer, i.message, i.stepId])).toEqual([
      ['#environments', 'Pick at least one environment.', 'where'],
      ['/evaluator/dataset', 'Choose a dataset.', 'where'],
      ['#name', 'Name the experiment.', 'where'],
    ]);
    expect(items.every((i) => i.source === 'local')).toBe(true);
  });

  it('reports an environment whose form failed to load', () => {
    const c = makeCtx({ envs: [makeEnv(PRODUCTION, 'production', { formError: 'Schema fetch failed' })] });
    expect(localErrors(valid(), c)[0]).toMatchObject({
      pointer: '#environments',
      message: 'Schema fetch failed (production)',
    });
  });

  it('blocks on a starting point that has not loaded', () => {
    const loading = valid({ base: { ...valid().base, kind: 'default', loading: true, loaded: false } });
    expect(localErrors(loading, ctx)[0]).toMatchObject({
      pointer: '#base',
      message: 'The starting point is still loading.',
      stepId: 'start',
    });
    const failed = valid({ base: { ...valid().base, kind: 'saved', loaded: false, error: 'Nope' } });
    expect(localErrors(failed, ctx)[0]?.message).toBe('Nope');
    const noError = valid({ base: { ...valid().base, kind: 'default', loaded: false } });
    expect(localErrors(noError, ctx)[0]?.message).toBe('The starting point did not load; pick another one.');
    expect(
      localErrors(valid({ base: { ...valid().base, kind: 'default', loaded: true, versionId: 'v1' } }), ctx),
    ).toEqual([]);
  });

  it('reports text that did not parse, with the descriptor label', () => {
    const d = setLeafInput(valid(), ctx.union.fields['/SQL_RESULT_LIMIT']!, '/SQL_RESULT_LIMIT', 'abc');
    expect(localErrors(d, ctx)).toEqual([
      expect.objectContaining({
        pointer: '/env_overrides/SQL_RESULT_LIMIT',
        message: 'Enter a number',
        label: 'Sql Result Limit',
        stepId: 'env',
        groupId: 'sql_runner',
      }),
    ]);
  });

  it('checks type and bounds', () => {
    const d = setValue(setValue(valid(), '/MILVUS_SEARCH_THRESHOLD', 1.5), '/TABLE_SELECTION_MODE', 'nope');
    const messages = localErrors(d, ctx).map((i) => [i.pointer, i.message]);
    expect(messages).toEqual([
      ['/env_overrides/MILVUS_SEARCH_THRESHOLD', 'Must be at most 1'],
      ['/env_overrides/TABLE_SELECTION_MODE', 'Must be one of the listed values'],
    ]);
    expect(
      localErrors(setValue(valid(), '/MILVUS_SEARCH_THRESHOLD', { sweep: [0.1, 7] }), ctx)[0],
    ).toMatchObject({
      pointer: '/env_overrides/MILVUS_SEARCH_THRESHOLD/sweep/1',
    });
  });

  it('reports a setting that is not in one of the environments', () => {
    const c = twoEnvCtx();
    const items = localErrors(
      valid({ environmentIds: [PRODUCTION, STAGING], values: { '/VIZ_MAX_GROUPS': 4 } }),
      c,
    );
    expect(items).toEqual([
      expect.objectContaining({
        pointer: '/env_overrides/VIZ_MAX_GROUPS',
        rule: 'not_in_environment',
        environmentId: STAGING,
        message: 'VIZ_MAX_GROUPS is not in environment "staging": reset it or deselect staging.',
      }),
    ]);
  });

  it('checks the versioning details and the description length', () => {
    const items = localErrors(valid({ versioningText: 'bad', description: 'x'.repeat(5001) }), ctx);
    expect(items.map((i) => i.pointer)).toEqual(['#description', '#versioning-details']);
  });

  it('reports invalid evaluation inputs and run_metadata mistakes on the evaluation step', () => {
    let d = setConfigInput(valid(), evaluatorPanel.descriptor.fields['/samples']!, 'samples', 'x');
    d = addMetaRow(d, evaluatorPanel);
    d = updateMetaRow(d, metaRowsOf(d, evaluatorPanel)[0]!.id, { key: 'qym_x', raw: '1' }, evaluatorPanel);
    const items = localErrors(d, ctx);
    expect(items.map((i) => [i.label, i.stepId])).toEqual([
      ['Evaluation inputs › Samples', 'eval'],
      ['Run metadata › qym_x', 'eval'],
    ]);
  });

  it('reports empty sweeps and uneven links with human labels', () => {
    const d = valid({
      values: { '/MILVUS_SEARCH_THRESHOLD': { sweep: [] } },
    });
    const items = localErrors(d, ctx).filter((i) => i.message.includes('Add at least one value'));
    expect(items[0]).toMatchObject({ label: 'Milvus Search Threshold', stepId: 'env' });
    expect(items[0]?.message).toBe(
      'Milvus Search Threshold: Add at least one value, or switch back to a single value',
    );
  });

  it('turns unapplied Raw JSON errors into one entry', () => {
    const items = localErrors(valid(), ctx, {
      rawJsonErrors: [{ message: 'Unknown key' }, { message: 'b' }],
    });
    expect(items[0]).toMatchObject({
      pointer: '#advanced-json',
      stepId: 'review',
      message: 'Raw JSON not applied: Unknown key (+1 more)',
    });
  });

  it('every item names a field to focus', () => {
    const items = localErrors(createDocument(), makeCtx({ envs: [] }));
    expect(items.map((i) => i.fieldName)).toEqual(items.map((i) => pointerToFieldName(i.pointer)));
  });
});

describe('human labels and steps', () => {
  it('labels a slot-filled field "<slot> › <role>"', () => {
    expect(locate('/env_overrides/LLM_OVERRIDES/endpoints/primary/model', ctx)).toMatchObject({
      label: 'Primary model › Model',
      stepId: 'env',
      groupId: 'llm_routing',
    });
    expect(locate('/env_overrides/LLM_OVERRIDES/endpoints/primary/base_url', ctx).label).toBe(
      'Primary model › Base URL',
    );
    expect(locate('/env_overrides/VIZ_LLM_MODEL', ctx).label).toBe('VIZ LLM model › Model');
  });

  it('labels other overrides from the descriptor chain, with keys and roles for template segments', () => {
    expect(locate('/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout', ctx).label).toBe(
      'Endpoints › primary › Timeout',
    );
    expect(locate('/env_overrides/LLM_OVERRIDES/main/temperature', ctx).label).toBe(
      'LLM_OVERRIDES › main › Temperature',
    );
    expect(locate('/env_overrides/NOPE/deep', ctx)).toMatchObject({
      label: 'NOPE › deep',
      groupId: 'unmatched',
    });
  });

  it('maps slot bindings, evaluator and pseudo pointers to steps', () => {
    expect(locate('/slot_bindings/endpoint:primary', ctx)).toEqual({
      label: 'Primary model',
      stepId: 'models',
    });
    expect(locate('/slot_bindings/endpoint:primary/temporary/model', ctx).label).toBe(
      'Primary model › Model',
    );
    expect(locate('/slot_bindings/endpoint:primary/sweep/2', ctx).label).toBe('Primary model › model 3');
    expect(locate('/slot_bindings/endpoint:ghost', ctx).label).toBe('endpoint:ghost');
    expect(locate('/evaluator/dataset', ctx)).toEqual({ label: 'Dataset', stepId: 'where' });
    expect(locate('/evaluator/config/max_concurrency', ctx)).toEqual({
      label: 'Evaluation inputs › Max Concurrency',
      stepId: 'eval',
    });
    expect(locate('/evaluator/config/run_metadata/team', ctx)).toEqual({
      label: 'Run metadata › team',
      stepId: 'eval',
    });
    expect(locate('/evaluator/report_k', ctx).stepId).toBe('eval');
    expect(locate('/links/0', ctx)).toEqual({ label: 'Sweeps › linked values', stepId: 'env' });
    expect(locate('#base', ctx).stepId).toBe('start');
    expect(locate('#advanced-json', ctx).stepId).toBe('review');
    expect(locate('', ctx)).toEqual({ label: 'Configuration', stepId: 'review' });
  });
});

describe('server errors', () => {
  const errors: ServerError[] = [
    {
      pointer: '/env_overrides/LLM_OVERRIDES/endpoints/primary/model',
      rule: 'schema',
      message: 'Required',
      environment_id: STAGING,
      combo_index: 1,
    },
    {
      pointer: '/env_overrides/MILVUS_SEARCH_THRESHOLD',
      rule: 'maximum',
      message: 'must be <= 1',
      environment_id: PRODUCTION,
      combo_index: null,
    },
    {
      pointer: '/env_overrides/LLM_OVERRIDES/endpoints/primary/model',
      rule: 'binding',
      message: 'conflict',
      slot_key: 'endpoint:primary',
    },
    { pointer: '', rule: 'sweep_cap', message: 'too many' },
  ];
  const c = twoEnvCtx();
  const d = valid({ environmentIds: [PRODUCTION, STAGING] });
  const preview: DryRunResponse = {
    dry_run: true,
    ok: false,
    errors,
    combo_count: 2,
    jobs: [{ environment_id: STAGING, combo_index: 1, label: 'threshold=0.7' }],
  };

  it('maps pointers to human labels, steps and fields; the pointer stays as secondary text', () => {
    const items = mapServerErrors(errors.slice(0, 3), d, c, preview);
    expect(items[0]).toMatchObject({
      label: 'Primary model › Model',
      pointer: '/env_overrides/LLM_OVERRIDES/endpoints/primary/model',
      stepId: 'env',
      groupId: 'llm_routing',
      fieldName: pointerToFieldName('/env_overrides/LLM_OVERRIDES/endpoints/primary/model'),
      where: ['staging', 'threshold=0.7'],
      source: 'server',
      rule: 'schema',
      comboIndex: 1,
    });
    expect(items[1]).toMatchObject({ label: 'Milvus Search Threshold', where: ['production'] });
  });

  it('a binding error points at the slot on the Models step', () => {
    const [, , binding] = mapServerErrors(errors.slice(0, 3), d, c, preview);
    expect(binding).toMatchObject({
      pointer: '/slot_bindings/endpoint:primary',
      label: 'Primary model',
      stepId: 'models',
      rule: 'binding',
    });
  });

  it('names the environment only when several are selected', () => {
    const [only] = mapServerErrors(errors.slice(1, 2), valid(), ctx, preview);
    expect(only?.where).toEqual([]);
  });

  it('falls back to "combination n" when the job has no label', () => {
    const [item] = mapServerErrors([{ pointer: '/x', message: 'm', combo_index: 3 }], d, c, {
      ...preview,
      jobs: [],
    });
    expect(item?.where).toEqual(['combination 4']);
  });

  it('lists server errors that are not local, not the cap, and not duplicates', () => {
    const local = [{ pointer: '/env_overrides/MILVUS_SEARCH_THRESHOLD' }] as never[];
    const visible = visibleServerErrors([...errors, errors[0]!], local);
    expect(visible.map((e) => e.rule)).toEqual(['schema', 'binding']);
  });

  it('combines local and server items, local first', () => {
    const items = validationItems(valid({ name: '' }), ctx, { errors: errors.slice(1, 2) });
    expect(items.map((i) => i.source)).toEqual(['local', 'server']);
  });
});

describe('review state', () => {
  const ok: DryRunResponse = {
    dry_run: true,
    ok: true,
    errors: [],
    job_count: 4,
    combo_count: 2,
    max_jobs: 100,
    jobs: [],
  };

  it('counts runs from the dry run, else from the local estimate', () => {
    const d = valid({ values: { '/MILVUS_SEARCH_THRESHOLD': { sweep: [0.1, 0.2, 0.3] } } });
    expect(runCount(d, ctx, null)).toEqual({ runs: 3, cap: 100, over: false });
    expect(runCount(d, ctx, ok)).toEqual({ runs: 4, cap: 100, over: false });
    expect(runCount(d, ctx, ok, true).runs).toBe(3); // the estimate while a check runs
  });

  it('is over the cap by the local estimate even when the dry run is stale', () => {
    const d = valid({ values: { '/MILVUS_SEARCH_THRESHOLD': { sweep: [1, 2, 3] } } });
    expect(runCount(d, makeCtx({ maxJobs: 2 }), null).over).toBe(true);
    expect(runCount(d, ctx, { ...ok, job_count: 500, max_jobs: 100 }).over).toBe(true);
    expect(runCount(d, makeCtx({ maxJobs: null }), null).over).toBe(false);
  });

  it('writes the status line and disables Launch over the cap', () => {
    const base = { doc: valid(), ctx };
    expect(reviewState({ ...base, preview: ok }).status).toBe('Ready to launch');
    expect(reviewState({ ...base, preview: ok }).canLaunch).toBe(true);
    expect(reviewState({ ...base, previewLoading: true }).status).toBe('Checking…');
    expect(reviewState({ ...base, previewError: 'boom' }).status).toBe('boom');
    expect(reviewState({ doc: valid({ name: '' }), ctx, preview: ok }).status).toBe('1 problem to fix');
    expect(reviewState({ doc: createDocument(), ctx: makeCtx({ envs: [] }) }).status).toBe(
      'Pick an environment to review.',
    );
    const over = reviewState({ ...base, preview: { ...ok, job_count: 200, max_jobs: 100 } });
    expect(over.status).toBe('Over the run limit');
    expect(over.canLaunch).toBe(false);
    expect(reviewState({ ...base, preview: ok, launching: true }).canLaunch).toBe(false);
  });

  it('prefers errors from a failed launch over the dry run', () => {
    const state = reviewState({
      doc: valid(),
      ctx,
      preview: { ...ok, errors: [{ pointer: '/a', message: 'old' }] },
      launchErrors: [{ pointer: '/b', message: 'new' }],
    });
    expect(state.items.map((i) => i.message)).toEqual(['new']);
  });

  it('labels the launch button', () => {
    expect(launchLabel(1, false)).toBe('Launch');
    expect(launchLabel(12, false)).toBe('Launch 12 runs');
    expect(launchLabel(12, true)).toBe('Launching…');
  });
});

describe('priority', () => {
  it('caps at the lowest maximum of the selected environments', () => {
    const c = makeCtx({
      envs: [
        makeEnv(PRODUCTION, 'p', { maxPriority: 'HIGH' }),
        makeEnv(STAGING, 's', { maxPriority: 'NORMAL' }),
      ],
    });
    expect(maxPriority(c)).toBe('NORMAL');
    expect(maxPriority(makeCtx({ envs: [] }))).toBe('HIGH');
  });

  it('disables HIGH for non-managers and priorities above the cap, with reasons', () => {
    const c = makeCtx({
      envs: [makeEnv(PRODUCTION, 'p', { maxPriority: 'NORMAL', defaultPriority: 'LOW' })],
      isManager: false,
    });
    expect(priorityOptions(c)).toEqual([
      { value: '', label: 'Environment default (LOW)', disabled: false },
      { value: 'LOW', label: 'LOW', disabled: false },
      { value: 'NORMAL', label: 'NORMAL', disabled: false },
      { value: 'HIGH', label: 'HIGH (managers only)', disabled: true },
    ]);
    const capped = makeCtx({ envs: [makeEnv(PRODUCTION, 'p', { maxPriority: 'NORMAL' })], isManager: true });
    expect(priorityOptions(capped)[3]).toMatchObject({
      label: 'HIGH (above the environment maximum)',
      disabled: true,
    });
  });

  it('clears a priority that is no longer allowed', () => {
    const capped = makeCtx({ envs: [makeEnv(PRODUCTION, 'p', { maxPriority: 'NORMAL' })] });
    expect(normalizePriority(valid({ priority: 'HIGH' }), capped).priority).toBe('');
    expect(normalizePriority(valid({ priority: 'LOW' }), capped).priority).toBe('LOW');
    expect(normalizePriority(valid({ priority: 'HIGH' }), makeCtx({ isManager: false })).priority).toBe('');
    const same = valid({ priority: 'HIGH' });
    expect(normalizePriority(same, ctx)).toBe(same);
  });

  it('warns per environment unless the dry run supplied the text', () => {
    expect(highWarnings(ctx)).toEqual(['Launching at HIGH preempts other jobs on production.']);
    expect(highWarnings(ctx, { dry_run: true, ok: true, errors: [], preemption_warning: 'custom' })).toEqual([
      'custom',
    ]);
  });
});

describe('launch failure', () => {
  it('recognises the preemption acknowledgement', () => {
    expect(
      parseLaunchFailure(422, { detail: { code: 'preemption_acknowledgement_required', message: 'ack me' } }),
    ).toEqual({ kind: 'preemption', message: 'ack me' });
  });

  it('reads validation errors', () => {
    const failure = parseLaunchFailure(422, {
      detail: { message: 'invalid', errors: [{ pointer: '/a', message: 'm' }] },
    });
    expect(failure).toEqual({
      kind: 'validation',
      message: 'invalid',
      errors: [{ pointer: '/a', message: 'm' }],
    });
  });

  it('reads plain, list and unknown error bodies', () => {
    expect(parseLaunchFailure(403, { detail: 'Not allowed' })).toEqual({
      kind: 'other',
      message: 'Not allowed',
    });
    expect(parseLaunchFailure(422, { detail: [{ loc: ['body'], msg: 'bad' }] })).toEqual({
      kind: 'other',
      message: 'bad',
    });
    expect(parseLaunchFailure(500, null)).toEqual({
      kind: 'other',
      message: 'Failed to launch the experiment',
    });
    expect(parseLaunchFailure(409, { detail: { message: 'conflict' } })).toEqual({
      kind: 'other',
      message: 'conflict',
    });
  });
});

describe('bindings validation stays out of the way', () => {
  it('a bound slot field is not validated as a raw value', () => {
    const d = setBinding(
      valid({ values: { '/LLM_OVERRIDES/endpoints/primary/timeout': -5 } }),
      ctx,
      'endpoint:primary',
      { kind: 'connection', id: 'conn-prod' },
    );
    expect(localErrors(d, ctx).map((i) => i.pointer)).toEqual([
      '/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout',
    ]);
  });
});
