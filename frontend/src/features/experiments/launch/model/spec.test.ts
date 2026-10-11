import { describe, expect, it } from 'vitest';
import { evaluatorPanel, makeCtx, PRODUCTION, STAGING } from './__fixtures__/fixtures';
import { setBinding, setGlobalModel } from './bindings';
import { createDocument } from './document';
import { setConfig } from './evaluator';
import { setValue } from './layering';
import { SecretStore } from './secrets';
import {
  baseSource,
  buildLaunchRequest,
  buildPresetConfig,
  buildSpec,
  dryRunKey,
  parseVersioning,
  specChanged,
  specKey,
  versioningText,
} from './spec';
import type { LaunchDocument, SlotBinding } from './types';

const ctx = makeCtx();
const secrets = () => new SecretStore();

function doc(extra: Partial<LaunchDocument> = {}): LaunchDocument {
  return createDocument({
    environmentIds: [PRODUCTION],
    name: ' Threshold run ',
    dataset: { mode: 'project', name: 'support-qa', ref: 'v:3', custom: '' },
    ...extra,
  });
}

describe('versioning details (B21)', () => {
  it('parses key=value lines, trimming and skipping blanks', () => {
    expect(parseVersioning('agent = v2\n\nprompt=p=17\n  kb=381  ')).toEqual({
      details: { agent: 'v2', prompt: 'p=17', kb: '381' },
      errors: [],
    });
  });

  it('reports lines without a key, long keys and more than 50 keys', () => {
    expect(parseVersioning('novalue\n=x\nok=1').errors).toEqual([
      'Line 1: write key=value.',
      'Line 2: write key=value.',
    ]);
    expect(parseVersioning('k'.repeat(101) + '=1').errors).toEqual([
      'Line 1: keys are at most 100 characters.',
    ]);
    expect(parseVersioning('k'.repeat(100) + '=1').errors).toEqual([]);
    const many = Array.from({ length: 51 }, (_, i) => `k${i}=v`).join('\n');
    expect(parseVersioning(many).errors).toEqual(['At most 50 versioning details.']);
    expect(parseVersioning(many.split('\n').slice(0, 50).join('\n')).errors).toEqual([]);
  });

  it('writes stored details back as lines (non-strings as JSON, nulls skipped)', () => {
    expect(versioningText({ b: 2, a: 'x', c: null, d: { z: 1 } })).toBe('a=x\nb=2\nd={"z":1}');
    expect(versioningText(null)).toBe('');
  });
});

describe('buildSpec', () => {
  it('builds evaluator, bindings and nested env_overrides', () => {
    let d = doc({ values: { '/MILVUS_SEARCH_THRESHOLD': 0.4, '/LLM_OVERRIDES/main/temperature': 0.1 } });
    d = setBinding(d, ctx, 'endpoint:primary', { kind: 'connection', id: 'conn-prod' });
    expect(buildSpec(d)).toEqual({
      evaluator: { dataset: 'support-qa', dataset_version: '3' },
      slot_bindings: { 'endpoint:primary': { connection_id: 'conn-prod' } },
      env_overrides: { MILVUS_SEARCH_THRESHOLD: 0.4, LLM_OVERRIDES: { main: { temperature: 0.1 } } },
    });
  });

  it('encodes the dataset ref: version, alias, latest and custom', () => {
    expect(buildSpec(doc()).evaluator).toEqual({ dataset: 'support-qa', dataset_version: '3' });
    expect(
      buildSpec(doc({ dataset: { mode: 'project', name: 'support-qa', ref: 'a:production', custom: '' } }))
        .evaluator,
    ).toEqual({
      dataset: 'support-qa',
      config: { dataset_alias: 'production' },
    });
    expect(
      buildSpec(doc({ dataset: { mode: 'project', name: 'support-qa', ref: '', custom: '' } })).evaluator,
    ).toEqual({ dataset: 'support-qa' });
    expect(
      buildSpec(doc({ dataset: { mode: 'custom', name: 'ignored', ref: 'v:9', custom: '  my/set ' } }))
        .evaluator,
    ).toEqual({ dataset: 'my/set' });
    expect(buildSpec(doc({ dataset: { mode: 'project', name: '', ref: '', custom: '' } })).evaluator).toEqual(
      { dataset: null },
    );
  });

  it('carries the base evaluator extras and evaluation-input edits', () => {
    const d = setConfig(doc({ evaluatorExtra: { report_k: 5, config: { samples: 2 } } }), 'timeout', 90);
    expect(buildSpec(d).evaluator).toEqual({
      dataset: 'support-qa',
      dataset_version: '3',
      report_k: 5,
      config: { samples: 2, timeout: 90 },
    });
  });

  it('keeps sweeps and links as they are', () => {
    const d = doc({
      values: { '/MILVUS_SEARCH_THRESHOLD': { sweep: [0.1, 0.2] } },
      links: [['/env_overrides/MILVUS_SEARCH_THRESHOLD', '/slot_bindings/endpoint:primary']],
      bindings: {
        'endpoint:primary': { kind: 'sweep', items: [{ connection_id: 'a' }, { connection_id: 'b' }] },
      },
    });
    const spec = buildSpec(d);
    expect(spec.env_overrides).toEqual({ MILVUS_SEARCH_THRESHOLD: { sweep: [0.1, 0.2] } });
    expect(spec.slot_bindings['endpoint:primary']).toEqual({
      sweep: [{ connection_id: 'a' }, { connection_id: 'b' }],
    });
    expect(spec.links).toEqual(d.links);
  });

  it('does not alias the document', () => {
    const d = doc({ values: { '/MILVUS_SEARCH_THRESHOLD': { sweep: [1] } } });
    const spec = buildSpec(d);
    (spec.env_overrides['MILVUS_SEARCH_THRESHOLD'] as { sweep: number[] }).sweep.push(2);
    expect(d.values['/MILVUS_SEARCH_THRESHOLD']).toEqual({ sweep: [1] });
  });
});

describe('base_source', () => {
  it('maps the base kinds to the request', () => {
    const info = (kind: string, extra: object) =>
      ({ ...createDocument().base, kind, loaded: true, ...extra }) as LaunchDocument['base'];
    expect(baseSource(doc())).toEqual({ kind: 'blank' });
    expect(baseSource(doc({ base: info('default', { versionId: 'v1' }) }))).toEqual({
      kind: 'official',
      preset_version_id: 'v1',
    });
    expect(baseSource(doc({ base: info('saved', { versionId: 'v2' }) }))).toEqual({
      kind: 'saved',
      preset_version_id: 'v2',
    });
    expect(baseSource(doc({ base: info('best_run', { runId: 'r1' }) }))).toEqual({
      kind: 'best_run',
      run_id: 'r1',
    });
    expect(baseSource(doc({ base: info('default', {}) }))).toEqual({ kind: 'blank' });
    const clone = {
      experimentId: 'x',
      jobId: null,
      spec: {},
      linkedGroups: undefined,
      sourceName: '',
      notes: [],
    };
    expect(baseSource(doc({ base: info('clone', {}), clone }))).toEqual({
      kind: 'clone',
      experiment_id: 'x',
    });
    expect(baseSource(doc({ base: info('clone', {}), clone: { ...clone, jobId: 'j' } }))).toEqual({
      kind: 'clone',
      experiment_id: 'x',
      job_id: 'j',
    });
  });
});

describe('buildLaunchRequest', () => {
  const temp = (ref: string, save = false): SlotBinding => ({
    kind: 'temporary',
    model: 'gpt-x',
    secretRef: ref,
    save,
    needsKey: false,
  });

  it('builds the body with name, environments, priority and versioning details', () => {
    const body = buildLaunchRequest(
      doc({
        environmentIds: [PRODUCTION, STAGING],
        priority: 'LOW',
        versioningText: 'agent=v2',
        description: ' why ',
      }),
      secrets(),
      { dryRun: false },
    );
    expect(body).toMatchObject({
      name: 'Threshold run',
      description: 'why',
      environment_ids: [PRODUCTION, STAGING],
      dry_run: false,
      priority: 'LOW',
      versioning_details: { agent: 'v2' },
      base_source: { kind: 'blank' },
      save_to_project_models: [],
      secrets: {},
    });
    expect(body.acknowledge_preemption).toBeUndefined();
  });

  it('omits empty optional fields and names an untitled dry run', () => {
    const body = buildLaunchRequest(doc({ name: '  ' }), secrets(), { dryRun: true });
    expect(body.name).toBe('Untitled experiment');
    expect(body.dry_run).toBe(true);
    expect('priority' in body).toBe(false);
    expect('description' in body).toBe(false);
    expect('versioning_details' in body).toBe(false);
    expect(buildLaunchRequest(doc({ name: '  ' }), secrets(), { dryRun: false }).name).toBe('');
  });

  it('keeps keys out of the spec: {$secret} in slot_bindings, the key only in secrets', () => {
    const store = secrets();
    store.put('sk-live-123', 'tmp-1');
    store.put('unused', 'tmp-gone');
    const d = setBinding(doc(), ctx, 'endpoint:primary', temp('tmp-1', true));
    const body = buildLaunchRequest(d, store, { dryRun: false });
    expect(body.secrets).toEqual({ 'tmp-1': 'sk-live-123' });
    expect(body.save_to_project_models).toEqual(['endpoint:primary']);
    expect(JSON.stringify(body.spec)).not.toContain('sk-live-123');
    expect(body.spec.slot_bindings['endpoint:primary']).toEqual({
      temporary: { model: 'gpt-x', api_key: { $secret: 'tmp-1' } },
    });
  });

  it('sends the keys of swept and global temporary models once', () => {
    const store = secrets();
    store.put('k-sweep', 'tmp-s');
    store.put('k-global', 'tmp-g');
    const swept = setBinding(doc(), ctx, 'flat:VIZ_LLM', {
      kind: 'sweep',
      items: [{ temporary: { model: 'm', api_key: { $secret: 'tmp-s' } } }, { connection_id: 'c' }],
    });
    expect(buildLaunchRequest(swept, store, { dryRun: false }).secrets).toEqual({ 'tmp-s': 'k-sweep' });
    const global = setGlobalModel(doc(), ctx, temp('tmp-g'));
    expect(buildLaunchRequest(global, store, { dryRun: false }).secrets).toEqual({ 'tmp-g': 'k-global' });
  });

  it('dry runs carry the keys like the vanilla form, unless told not to', () => {
    const store = secrets();
    store.put('k', 'tmp-1');
    const d = setBinding(doc(), ctx, 'endpoint:primary', temp('tmp-1'));
    expect(buildLaunchRequest(d, store, { dryRun: true }).secrets).toEqual({ 'tmp-1': 'k' });
    expect(buildLaunchRequest(d, store, { dryRun: true, secretsInDryRun: false }).secrets).toEqual({});
  });

  it('acknowledges the preemption warning when asked', () => {
    expect(
      buildLaunchRequest(doc({ priority: 'HIGH' }), secrets(), { dryRun: false, acknowledgePreemption: true })
        .acknowledge_preemption,
    ).toBe(true);
  });

  it('does not mutate the document or the store', () => {
    const store = secrets();
    store.put('k', 'tmp-1');
    const d = setBinding(doc(), ctx, 'endpoint:primary', temp('tmp-1'));
    const before = JSON.stringify(d);
    buildLaunchRequest(d, store, { dryRun: false });
    expect(JSON.stringify(d)).toBe(before);
    expect(store.has('tmp-1')).toBe(true);
  });
});

describe('change detection', () => {
  const a = doc({ values: { '/BRIEF_ENABLED': true } });

  it('name, priority, description and versioning are not spec changes', () => {
    for (const patch of [
      { name: 'other' },
      { priority: 'HIGH' as const },
      { description: 'd' },
      { versioningText: 'a=b' },
    ]) {
      expect(specChanged(a, { ...a, ...patch })).toBe(false);
    }
  });

  it('settings, dataset, bindings, environments and evaluator inputs are', () => {
    expect(specChanged(a, setValue(a, '/BRIEF_ENABLED', false))).toBe(true);
    expect(specChanged(a, { ...a, dataset: { ...a.dataset, ref: 'v:4' } })).toBe(true);
    expect(specChanged(a, setBinding(a, ctx, 'endpoint:primary', { kind: 'connection', id: 'c' }))).toBe(
      true,
    );
    expect(specChanged(a, { ...a, environmentIds: [PRODUCTION, STAGING] })).toBe(true);
    expect(specChanged(a, setConfig(a, 'timeout', 5))).toBe(true);
  });

  it('dry-run key is stable for the same content and changes with the request fields too', () => {
    const same = { ...a, values: { ...a.values } };
    expect(dryRunKey(a)).toBe(dryRunKey(same));
    expect(dryRunKey(a)).not.toBe(dryRunKey({ ...a, name: 'renamed' })); // run names depend on it
    expect(dryRunKey(a)).not.toBe(dryRunKey({ ...a, priority: 'HIGH' }));
    expect(dryRunKey({ ...a, name: ' x ' })).toBe(dryRunKey({ ...a, name: 'x' }));
    expect(specKey(a, evaluatorPanel)).toBe(specKey(same, evaluatorPanel));
  });

  it('dry-run key never contains a key value', () => {
    const store = new SecretStore();
    store.put('sk-top-secret', 'tmp-1');
    const d = setBinding(a, ctx, 'endpoint:primary', {
      kind: 'temporary',
      model: 'm',
      secretRef: 'tmp-1',
      save: false,
      needsKey: false,
    });
    expect(dryRunKey(d)).not.toContain('sk-top-secret');
    expect(dryRunKey(d)).toContain('tmp-1');
  });

  it('key order in the values does not matter', () => {
    const x = doc({ values: { '/A': 1, '/B': 2 } });
    const y = doc({ values: { '/B': 2, '/A': 1 } });
    expect(dryRunKey(x)).toBe(dryRunKey(y));
  });
});

describe('preset config', () => {
  it('has no key, no empty dataset and carries the schema hash', () => {
    const d = setBinding(
      doc({ dataset: { mode: 'project', name: '', ref: '', custom: '' } }),
      ctx,
      'endpoint:primary',
      { kind: 'temporary', model: 'm', secretRef: 'tmp-1', save: false, needsKey: false },
    );
    const cfg = buildPresetConfig(d, 'hash-1');
    expect(cfg.schema_hash).toBe('hash-1');
    expect(cfg.evaluator).toEqual({});
    expect(cfg.slot_bindings?.['endpoint:primary']).toEqual({ temporary: { model: 'm' } });
  });
});
