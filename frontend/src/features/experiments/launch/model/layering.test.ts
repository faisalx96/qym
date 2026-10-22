import { describe, expect, it } from 'vitest';
import { makeCtx, makeEnv, PRODUCTION, twoEnvCtx } from './__fixtures__/fixtures';
import { createDocument } from './document';
import { setBinding } from './bindings';
import { SecretStore } from './secrets';
import {
  applyBase,
  baseAvailability,
  baseLabel,
  baselineFrom,
  bindingChanged,
  captureEdits,
  changedPointers,
  changedSlots,
  cloneExtraEndpoints,
  datasetChanged,
  describeBaseChange,
  diffCount,
  diffText,
  droppedChangesMessage,
  failedBase,
  isChanged,
  loadedBaseFromBestRun,
  loadedBaseFromClone,
  loadedBaseFromPreset,
  pendingBestRunBase,
  pickBaseEnv,
  prefillFromClone,
  pruneBindings,
  pruneOrphanValues,
  resetAll,
  resetField,
  resetRoles,
  resetSettings,
  resetSlot,
  reuseTemporaryPrompt,
  scratchBase,
  setAllInput,
  setLeafInput,
  setValue,
  stepChangeCount,
  addKey,
  removeKey,
  type LoadedBase,
} from './layering';
import type {
  BestRunBaseResponse,
  CloneResponse,
  LaunchConfig,
  LaunchDocument,
  PresetVersionResponse,
} from './types';

const ctx = makeCtx();
const f = ctx.union.fields;

const presetConfig: LaunchConfig = {
  evaluator: {
    dataset: 'support-qa',
    dataset_version: '3',
    report_k: 5,
    config: { samples: 2, run_metadata: { team: 'a', qym_launch: 'x' } },
  },
  slot_bindings: {
    'endpoint:primary': { connection_id: 'conn-prod' },
    'flat:VIZ_LLM': { temporary: { model: 'viz-m', api_key: { $secret: 'old' } } },
    'endpoint:ghost': { connection_id: 'conn-prod' },
  },
  env_overrides: {
    MILVUS_SEARCH_THRESHOLD: 0.4,
    SQL_RESULT_LIMIT: 50,
    LLM_OVERRIDES: {
      endpoints: { primary: { model: 'filled-by-slot', timeout: 30 } },
      main: { temperature: 0.1 },
    },
    GONE_SETTING: 1,
  },
};

function laid(config: LaunchConfig = presetConfig, c = ctx): { doc: LaunchDocument; loaded: LoadedBase } {
  const loaded: LoadedBase = {
    base: baselineFrom(config, c),
    info: { ...scratchBase(c).info, kind: 'default', versionId: 'v1', version: 3, loaded: true },
  };
  const doc = applyBase(createDocument({ environmentIds: [PRODUCTION] }), c, loaded).doc;
  return { doc, loaded };
}

describe('baselineFrom', () => {
  const base = baselineFrom(presetConfig, ctx);

  it('flattens settings and drops what no environment knows, with a note', () => {
    expect(base.values['/MILVUS_SEARCH_THRESHOLD']).toBe(0.4);
    expect(base.values['/LLM_OVERRIDES/endpoints/primary/timeout']).toBe(30);
    expect(base.values['/GONE_SETTING']).toBeUndefined();
    expect(base.notes).toContain('GONE_SETTING was dropped: not in any selected environment.');
  });

  it('removes raw values under a bound slot (binding_conflict)', () => {
    expect(base.bindings['endpoint:primary']).toEqual({ kind: 'connection', id: 'conn-prod' });
    expect(base.values['/LLM_OVERRIDES/endpoints/primary/model']).toBeUndefined();
  });

  it('keeps temporary models without their key and asks for it again', () => {
    expect(base.bindings['flat:VIZ_LLM']).toMatchObject({
      kind: 'temporary',
      model: 'viz-m',
      secretRef: null,
      needsKey: true,
    });
  });

  it('notes a slot no environment confirms', () => {
    expect(base.notes.some((n) => n.startsWith('Model slot endpoint:ghost is not confirmed'))).toBe(true);
  });

  it('notes a model that cannot be used or no longer exists', () => {
    const b = baselineFrom({ slot_bindings: { 'endpoint:primary': { connection_id: 'deleted' } } }, ctx);
    expect(b.bindings).toEqual({});
    expect(b.notes[0]).toBe('Model deleted no longer exists for Primary model; pick another model.');
  });

  it('maps a project dataset version onto the picker and the rest into the extras', () => {
    expect(base.dataset).toEqual({ mode: 'project', name: 'support-qa', ref: 'v:3', custom: '' });
    expect(base.evaluatorExtra).toEqual({
      report_k: 5,
      config: { samples: 2, run_metadata: { team: 'a', qym_launch: 'x' } },
    });
  });

  it('maps an alias, and a custom dataset string', () => {
    const alias = baselineFrom(
      { evaluator: { dataset: 'legal-set', config: { dataset_alias: 'production' } } },
      ctx,
    );
    expect(alias.dataset).toEqual({ mode: 'project', name: 'legal-set', ref: 'a:production', custom: '' });
    expect(alias.evaluatorExtra).toEqual({});
    const custom = baselineFrom({ evaluator: { dataset: 'my/own set' } }, ctx);
    expect(custom.dataset).toEqual({ mode: 'custom', name: '', ref: '', custom: 'my/own set' });
  });

  it('an empty base has no dataset', () => {
    expect(baselineFrom({}, ctx).dataset).toBeNull();
  });
});

describe('baseline vs edits', () => {
  const { doc } = laid();

  it('a freshly laid base has no changes', () => {
    expect(diffCount(doc)).toEqual({ settings: 0, models: 0, dataset: 0, shape: 0, tasks: 0, total: 0 });
    expect(diffText(doc)).toBe('0 changes on top');
    expect(doc.values).toEqual(doc.baseline.values);
    expect(doc.dataset).toEqual({ mode: 'project', name: 'support-qa', ref: 'v:3', custom: '' });
  });

  it('counts changed settings, models and dataset', () => {
    let d = setValue(doc, '/MILVUS_SEARCH_THRESHOLD', 0.9);
    d = setValue(d, '/BRIEF_ENABLED', true);
    d = setBinding(d, ctx, 'endpoint:primary', { kind: 'connection', id: 'conn-mini' });
    d = { ...d, dataset: { ...d.dataset, ref: 'v:4' } };
    expect(changedPointers(d).sort()).toEqual(['/BRIEF_ENABLED', '/MILVUS_SEARCH_THRESHOLD']);
    expect(changedSlots(d)).toEqual(['endpoint:primary']);
    expect(datasetChanged(d)).toBe(true);
    expect(diffCount(d)).toEqual({ settings: 2, models: 1, dataset: 1, shape: 0, tasks: 0, total: 4 });
    expect(diffText(d)).toBe('4 changes on top');
    expect(diffText(setValue(doc, '/BRIEF_ENABLED', true))).toBe('1 change on top');
  });

  it('setting a field back to the base value is not a change', () => {
    const d = setValue(setValue(doc, '/MILVUS_SEARCH_THRESHOLD', 0.9), '/MILVUS_SEARCH_THRESHOLD', 0.4);
    expect(isChanged(d, '/MILVUS_SEARCH_THRESHOLD')).toBe(false);
  });

  it('unsetting a base value is a change; unparsable text is a change', () => {
    expect(isChanged(setValue(doc, '/MILVUS_SEARCH_THRESHOLD', undefined), '/MILVUS_SEARCH_THRESHOLD')).toBe(
      true,
    );
    const bad = setLeafInput(doc, f['/SQL_RESULT_LIMIT']!, '/SQL_RESULT_LIMIT', 'abc');
    expect(bad.invalid['/SQL_RESULT_LIMIT']).toMatchObject({ message: 'Enter a number', raw: 'abc' });
    expect(bad.values['/SQL_RESULT_LIMIT']).toBeUndefined();
    expect(isChanged(bad, '/SQL_RESULT_LIMIT')).toBe(true);
    const fixed = setLeafInput(bad, f['/SQL_RESULT_LIMIT']!, '/SQL_RESULT_LIMIT', '50');
    expect(fixed.invalid).toEqual({});
    expect(isChanged(fixed, '/SQL_RESULT_LIMIT')).toBe(false);
  });

  it('badges: env_overrides on the env step, evaluation inputs on the eval step', () => {
    const d = setValue(doc, '/BRIEF_ENABLED', true);
    expect(stepChangeCount(d, ctx, 'env')).toBe(1);
    expect(stepChangeCount(d, ctx, 'models')).toBe(0);
    expect(stepChangeCount(d, ctx, 'eval')).toBe(0);
  });

  it('writes one text to many targets ("All roles")', () => {
    const targets = ['/LLM_OVERRIDES/main/temperature', '/LLM_OVERRIDES/router/temperature'];
    const r = setAllInput(doc, f['/LLM_OVERRIDES/{role}/temperature']!, targets, '0.3');
    expect(r.doc.values['/LLM_OVERRIDES/router/temperature']).toBe(0.3);
    expect(setAllInput(doc, f['/LLM_OVERRIDES/{role}/temperature']!, targets, 'x').error).toBe(
      'Enter a number',
    );
    expect(
      setAllInput(r.doc, f['/LLM_OVERRIDES/{role}/temperature']!, targets, '').doc.values[
        '/LLM_OVERRIDES/main/temperature'
      ],
    ).toBeUndefined();
  });

  it('adds and removes collection keys with their values', () => {
    let d = addKey(doc, '/LLM_OVERRIDES/endpoints', 'judge');
    d = setValue(d, '/LLM_OVERRIDES/endpoints/judge/model', 'm');
    expect(d.addedKeys['/LLM_OVERRIDES/endpoints']).toEqual(['judge']);
    d = removeKey(d, '/LLM_OVERRIDES/endpoints', '/LLM_OVERRIDES/endpoints/judge', 'judge');
    expect(d.addedKeys['/LLM_OVERRIDES/endpoints']).toEqual([]);
    expect(d.values['/LLM_OVERRIDES/endpoints/judge/model']).toBeUndefined();
    expect(addKey(d, '/LLM_OVERRIDES/endpoints', 'x')).not.toBe(d);
  });
});

describe('reset', () => {
  const { doc } = laid();
  const edited = setBinding(
    setValue(setValue(doc, '/MILVUS_SEARCH_THRESHOLD', 0.9), '/BRIEF_ENABLED', true),
    ctx,
    'endpoint:primary',
    { kind: 'connection', id: 'conn-mini' },
  );

  it('resets one field to the base value or removes it when the base had none', () => {
    expect(resetField(edited, '/MILVUS_SEARCH_THRESHOLD').values['/MILVUS_SEARCH_THRESHOLD']).toBe(0.4);
    expect(resetField(edited, '/BRIEF_ENABLED').values['/BRIEF_ENABLED']).toBeUndefined();
  });

  it('resets one slot to the base model (or inherit)', () => {
    expect(resetSlot(edited, ctx, 'endpoint:primary').bindings['endpoint:primary']).toEqual({
      kind: 'connection',
      id: 'conn-prod',
    });
    const noBase = setBinding(edited, ctx, 'endpoint:other' as never, { kind: 'connection', id: 'x' });
    expect(resetSlot(noBase, ctx, 'endpoint:other').bindings['endpoint:other']).toBeUndefined();
  });

  it('resets only the settings, or everything', () => {
    const s = resetSettings(edited, ctx);
    expect(diffCount(s)).toMatchObject({ settings: 0, models: 1 });
    const all = resetAll(edited, ctx);
    expect(diffCount(all).total).toBe(0);
  });

  it('keeps a re-entered key when the model itself is unchanged', () => {
    const secrets = new SecretStore();
    secrets.put('K', 'tmp-new');
    const withKey = {
      ...doc,
      bindings: {
        ...doc.bindings,
        'flat:VIZ_LLM': {
          ...(doc.bindings['flat:VIZ_LLM'] as object),
          secretRef: 'tmp-new',
          needsKey: false,
        },
      },
    } as unknown as LaunchDocument;
    const all = resetAll(withKey, ctx, secrets);
    expect((all.bindings['flat:VIZ_LLM'] as { secretRef: string }).secretRef).toBe('tmp-new');
    expect(secrets.has('tmp-new')).toBe(true);
  });

  it('drops the values under role rows', () => {
    const d = setValue(doc, '/LLM_OVERRIDES/router/temperature', 0.5);
    expect(
      resetRoles(d, ['/LLM_OVERRIDES/router']).values['/LLM_OVERRIDES/router/temperature'],
    ).toBeUndefined();
  });
});

describe('changing the starting point replays the edits that still fit', () => {
  const { doc } = laid();
  const edited = setBinding(
    setValue(setValue(doc, '/MILVUS_SEARCH_THRESHOLD', 0.9), '/STAGING_ONLY_FLAG', true),
    ctx,
    'endpoint:primary',
    { kind: 'connection', id: 'conn-mini' },
  );

  it('captures what differs from the base', () => {
    const edits = captureEdits(edited);
    expect(Object.keys(edits.values).sort()).toEqual(['/MILVUS_SEARCH_THRESHOLD', '/STAGING_ONLY_FLAG']);
    expect(edits.bindings).toEqual({ 'endpoint:primary': { kind: 'connection', id: 'conn-mini' } });
    expect(edits.dataset).toBeNull();
  });

  it('keeps edits whose setting exists on the new base and reports the dropped ones', () => {
    const next: LoadedBase = {
      base: baselineFrom({ env_overrides: { SQL_RESULT_LIMIT: 7 } }, ctx),
      info: scratchBase(ctx).info,
    };
    const result = applyBase(edited, ctx, next);
    expect(result.kept).toBe(2); // threshold + primary binding
    expect(result.dropped).toBe(1);
    expect(result.droppedItems).toEqual(['/STAGING_ONLY_FLAG']);
    expect(result.doc.values['/MILVUS_SEARCH_THRESHOLD']).toBe(0.9);
    expect(result.doc.values['/SQL_RESULT_LIMIT']).toBe(7);
    expect(result.doc.bindings['endpoint:primary']).toEqual({ kind: 'connection', id: 'conn-mini' });
    expect(result.doc.baseline.values).toEqual({ '/SQL_RESULT_LIMIT': 7 });
    expect(diffCount(result.doc).total).toBe(2);
    expect(result.doc.base.kind).toBe('scratch');
    expect(droppedChangesMessage(1)).toBe('1 change did not fit the new starting point and was dropped');
    expect(droppedChangesMessage(2)).toBe('2 changes did not fit the new starting point and were dropped');
  });

  it('drops a binding edit for a slot the new environments do not confirm', () => {
    const next: LoadedBase = { base: baselineFrom({}, ctx), info: scratchBase(ctx).info };
    const noViz = makeCtx({
      envs: [
        makeEnv(PRODUCTION, 'production', {
          slots: [
            {
              slot_key: 'endpoint:primary',
              kind: 'endpoint',
              label: 'Primary model',
              field_map: { model: '/LLM_OVERRIDES/endpoints/primary/model' },
              required: true,
            },
          ],
        }),
      ],
    });
    const withViz = setBinding(edited, ctx, 'flat:VIZ_LLM', { kind: 'connection', id: 'conn-prod' });
    const result = applyBase(withViz, noViz, next);
    expect(result.droppedItems).toContain('/slot_bindings/flat:VIZ_LLM');
  });

  it('keeps invalid text edits and a changed dataset', () => {
    const bad = setLeafInput(doc, f['/SQL_RESULT_LIMIT']!, '/SQL_RESULT_LIMIT', 'abc');
    const withDataset = { ...bad, dataset: { mode: 'custom' as const, name: '', ref: '', custom: 'my-set' } };
    const next: LoadedBase = { base: baselineFrom({}, ctx), info: scratchBase(ctx).info };
    const result = applyBase(withDataset, ctx, next);
    expect(result.doc.invalid['/SQL_RESULT_LIMIT']?.raw).toBe('abc');
    expect(result.doc.dataset.custom).toBe('my-set');
  });

  it('wording of the confirm', () => {
    expect(describeBaseChange(doc, 'Default preset v3').needed).toBe(false);
    const c = describeBaseChange(edited, 'Default preset v3');
    expect(c).toMatchObject({
      needed: true,
      count: 3,
      title: 'Change the starting point?',
      confirmLabel: 'Change starting point',
      cancelLabel: 'Keep current',
    });
    expect(c.description[0]).toBe('You have 3 changes on top of Default preset v3.');
  });

  it('a base not yet laid (blank document) has nothing to replay', () => {
    const result = applyBase(createDocument(), ctx, laid().loaded);
    expect(result.kept).toBe(0);
    expect(result.dropped).toBe(0);
  });
});

describe('bases from server responses', () => {
  it('a preset version re-mapped onto the current schema', () => {
    const res: PresetVersionResponse = {
      version: {
        id: 'ver-1',
        version: 3,
        config: {},
        notes: 'tuned',
        warnings: [
          { rule: 'schema_hash', message: 'old' },
          { rule: 'model', message: 'model gone' },
        ],
      },
      remap: {
        config: presetConfig,
        dropped: [{ pointer: '/X', message: 'removed' }],
        errors: ['bad'],
        summary: '1 dropped',
      },
    };
    const loaded = loadedBaseFromPreset('saved', PRODUCTION, { id: 'p1', name: 'Tuned' }, res, ctx);
    expect(loaded.info).toMatchObject({
      kind: 'saved',
      loaded: true,
      versionId: 'ver-1',
      version: 3,
      presetId: 'p1',
      presetName: 'Tuned',
      releaseNotes: 'tuned',
      summary: '1 dropped',
      warnings: ['model gone'],
      errors: ['bad'],
      envId: PRODUCTION,
    });
    expect(loaded.info.dropped).toHaveLength(1);
    expect(loaded.base.values['/SQL_RESULT_LIMIT']).toBe(50);
    expect(baseLabel({ base: loaded.info, clone: null, environmentIds: [PRODUCTION] })).toBe(
      'Saved preset “Tuned” v3',
    );
    expect(
      loadedBaseFromPreset('default', PRODUCTION, { id: 'p', name: 'x' }, res, ctx).info.presetName,
    ).toBeNull();
  });

  it('a preset response without a remap is a failed base', () => {
    const loaded = loadedBaseFromPreset(
      'default',
      PRODUCTION,
      { id: 'p', name: 'x' },
      { version: { id: 'v', version: 1, config: {} } },
      ctx,
    );
    expect(loaded.info.loaded).toBe(false);
    expect(loaded.info.error).toBe('Failed to load the preset');
  });

  it('a best run carries drift, prompts and a header', () => {
    const res: BestRunBaseResponse = {
      run: { id: 'abcdef1234567890' },
      base_source: { kind: 'best_run' },
      config: presetConfig,
      score: 0.84,
      metric: 'accuracy',
      versioning: { agent_version: 'v1.12', kb_version: '381' },
      drift: { status: 'changed', changes: [{ key: 'agent_version', run: 'v1.12', latest: 'v1.13' }] },
      prompts: [{ slot_key: 'flat:VIZ_LLM', model: 'viz-m' }],
      warnings: [{ message: 'careful' }],
    };
    const loaded = loadedBaseFromBestRun(PRODUCTION, res, ctx);
    expect(loaded.info).toMatchObject({
      kind: 'best_run',
      runId: 'abcdef1234567890',
      metric: 'accuracy',
      warnings: ['careful'],
    });
    expect(loaded.info.label).toBe('run abcdef12 · accuracy 0.84 · agent v1.12 / kb 381');
    expect(baseLabel({ base: loaded.info, clone: null, environmentIds: [PRODUCTION] })).toBe(
      loaded.info.label,
    );
    expect(loaded.info.drift?.status).toBe('changed');
    expect(pendingBestRunBase(PRODUCTION, ctx).info).toMatchObject({ pending: true, loaded: false });
    expect(failedBase('default', PRODUCTION, 'boom', ctx).info).toMatchObject({
      loaded: false,
      error: 'boom',
    });
  });

  it('re-binds a temporary model the run used and asks for its key', () => {
    const { doc } = laid();
    const r = reuseTemporaryPrompt(doc, ctx, {
      slot_key: 'endpoint:primary',
      model: 'gpt-x',
      label: 'X',
      base_url: 'https://x',
    });
    expect(r.doc.bindings['endpoint:primary']).toMatchObject({
      kind: 'temporary',
      model: 'gpt-x',
      needsKey: true,
      secretRef: null,
    });
    expect(reuseTemporaryPrompt(doc, ctx, { slot_key: 'nope', model: 'x' }).error).toContain(
      'is not confirmed',
    );
  });
});

describe('clone prefill', () => {
  const res: CloneResponse = {
    name: 'Threshold sweep (copy)',
    description: 'why',
    environment_ids: [PRODUCTION, 'gone-env'],
    unavailable_environment_ids: ['gone-env'],
    base_source: { kind: 'clone', experiment_id: 'x1' },
    priority: 'HIGH',
    spec: {
      evaluator: { dataset: 'support-qa' },
      slot_bindings: {
        'endpoint:primary': { temporary: { model: 'm', api_key: { $secret: 'gone' } } },
        'flat:VIZ_LLM': { sweep: [{ connection_id: 'conn-prod' }, { temporary: { model: 'z' } }] },
        'endpoint:fast': { connection_id: 'conn-prod' },
      },
      env_overrides: { MILVUS_SEARCH_THRESHOLD: { sweep: [0.1, 0.2] } },
      links: [['/env_overrides/MILVUS_SEARCH_THRESHOLD', '/slot_bindings/flat:VIZ_LLM']],
    },
  };

  it('builds the document patch and the key re-entry list', () => {
    const p = prefillFromClone(res, { experimentId: 'x1' });
    expect(p.patch).toMatchObject({
      name: 'Threshold sweep (copy)',
      description: 'why',
      environmentIds: [PRODUCTION, 'gone-env'],
      priority: 'HIGH',
    });
    expect(p.patch).not.toHaveProperty('versioningText');
    expect(p.patch.base).toMatchObject({ kind: 'clone', loaded: false });
    expect(p.needsKeyReentry).toEqual(['endpoint:primary', 'flat:VIZ_LLM']);
    expect(p.unavailableEnvironments).toBe(1);
    expect(p.notes).toEqual([
      '1 environment of the original is disabled or gone and was left out.',
      'Temporary models are copied without their API keys: re-enter each key under Models (endpoint:primary, flat:VIZ_LLM).',
      'Swept values are kept as they were, so the same combinations are launched.',
    ]);
    expect(p.patch.clone?.linkedGroups).toEqual(res.spec.links);
  });

  it('lays the clone as the base: temporary models lose their keys, sweeps stay', () => {
    const p = prefillFromClone(res, { experimentId: 'x1' });
    const clone = p.patch.clone!;
    const c = makeCtx();
    expect(cloneExtraEndpoints(clone, c)).toEqual(['fast']);
    const loaded = loadedBaseFromClone(clone, c);
    expect(loaded.base.bindings['endpoint:primary']).toMatchObject({
      kind: 'temporary',
      secretRef: null,
      needsKey: true,
    });
    expect(loaded.base.bindings['flat:VIZ_LLM']).toMatchObject({ kind: 'sweep' });
    expect(loaded.base.values['/MILVUS_SEARCH_THRESHOLD']).toEqual({ sweep: [0.1, 0.2] });
    const doc = applyBase(createDocument({ ...p.patch }), c, loaded).doc;
    expect(doc.links).toEqual(res.spec.links);
    expect(baseLabel(doc)).toBe('Clone of Threshold sweep');
    expect(diffCount(doc).total).toBe(0);
  });

  it('a one-job clone falls back to the job snapshot when the server ignored job_id', () => {
    const p = prefillFromClone(
      { ...res, base_source: { kind: 'clone', experiment_id: 'x1' } },
      {
        experimentId: 'x1',
        jobId: 'j9',
        jobRow: {
          id: 'j9',
          environment_id: PRODUCTION,
          qym_config: {
            evaluator: { dataset: 'legal-set' },
            slot_bindings: {},
            env_overrides: { BRIEF_ENABLED: true },
          },
        },
      },
    );
    expect(p.patch.clone).toMatchObject({ jobId: 'j9', linkedGroups: undefined });
    expect(p.patch.clone?.spec.env_overrides).toEqual({ BRIEF_ENABLED: true });
    expect(p.patch.environmentIds).toEqual([PRODUCTION]);
    expect(baseLabel({ base: p.patch.base, clone: p.patch.clone, environmentIds: [] })).toBe(
      'Clone of Threshold sweep (one job)',
    );
  });

  it('says so when the asked-for job is nowhere', () => {
    const p = prefillFromClone(res, { experimentId: 'x1', jobId: 'missing' });
    expect(p.notes[0]).toBe("That job's configuration was not found, so the whole experiment is cloned.");
    expect(p.patch.clone?.jobId).toBeNull();
  });

  it('accepts a job-scoped response', () => {
    const p = prefillFromClone(
      { ...res, base_source: { kind: 'clone', experiment_id: 'x1', job_id: 'j1' } },
      { experimentId: 'x1', jobId: 'j1' },
    );
    expect(p.patch.clone?.jobId).toBe('j1');
    expect(p.patch.clone?.linkedGroups).toBeUndefined();
  });
});

describe('pruning after the environments change', () => {
  it('drops bindings of slots no selected environment confirms', () => {
    const { doc } = laid();
    const pruned = pruneBindings(doc, makeCtx({ envs: [makeEnv(PRODUCTION, 'p', { slots: [] })] }));
    expect(pruned.bindings).toEqual({});
    expect(pruned.baseline.bindings).toEqual({});
  });

  it('drops edits that no selected environment knows (needs every form)', () => {
    const doc = createDocument({ values: { '/BRIEF_ENABLED': true, '/GHOST': 1 } });
    expect(pruneOrphanValues(doc, ctx).values).toEqual({ '/BRIEF_ENABLED': true });
    const two = twoEnvCtx();
    expect(pruneOrphanValues(createDocument({ values: { '/VIZ_MAX_GROUPS': 3 } }), two).values).toEqual({
      '/VIZ_MAX_GROUPS': 3,
    });
    const loading = makeCtx({ envs: [makeEnv(PRODUCTION, 'p', { formError: 'x' })] });
    expect(pruneOrphanValues(createDocument({ values: { '/GHOST': 1 } }), loading).values).toEqual({
      '/GHOST': 1,
    });
  });
});

describe('base choice', () => {
  const withPreset = { id: 'a', name: 'A', official_preset_id: 'p', official_preset_version: 2 };
  const without = { id: 'b', name: 'B' };

  it('prefers an environment with a default preset', () => {
    expect(pickBaseEnv([without, withPreset])).toBe('a');
    expect(pickBaseEnv([without])).toBe('b');
    expect(pickBaseEnv([])).toBeNull();
  });

  it('says why a base is not available', () => {
    expect(baseAvailability('default', withPreset)).toEqual({ ok: true });
    expect(baseAvailability('default', without)).toEqual({
      ok: false,
      reason: 'No default preset is published for B',
    });
    expect(baseAvailability('saved', without, { savedPresets: 0 })).toEqual({
      ok: false,
      reason: 'No saved presets for B yet',
    });
    expect(baseAvailability('saved', without, { savedPresets: null })).toEqual({
      ok: false,
      reason: 'Loading saved presets…',
    });
    expect(baseAvailability('saved', without, { savedPresets: 2 })).toEqual({ ok: true });
    expect(baseAvailability('scratch', null)).toEqual({ ok: true });
    expect(baseAvailability('best_run', null)).toEqual({ ok: false, reason: 'Pick an environment first' });
    expect(baseAvailability('clone', null, { hasClone: true })).toEqual({ ok: true });
  });

  it('labels the default preset with its environment when several are selected', () => {
    const { loaded } = laid();
    const info = { ...loaded.info, envId: PRODUCTION };
    expect(
      baseLabel({ base: info, clone: null, environmentIds: [PRODUCTION, 'x'] }, () => 'production'),
    ).toBe('Default preset v3 · production');
    expect(baseLabel({ base: info, clone: null, environmentIds: [PRODUCTION] })).toBe('Default preset v3');
  });
});

describe('binding changed selector', () => {
  it('ignores a re-entered key', () => {
    const { doc } = laid();
    const withKey = {
      ...doc,
      bindings: {
        ...doc.bindings,
        'flat:VIZ_LLM': { ...(doc.bindings['flat:VIZ_LLM'] as object), secretRef: 'r' },
      },
    } as unknown as LaunchDocument;
    expect(bindingChanged(withKey, 'flat:VIZ_LLM')).toBe(false);
  });
});
