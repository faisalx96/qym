import { describe, expect, it } from 'vitest';
import { evaluatorPanel, makeCtx, makeEnv, PRODUCTION } from './__fixtures__/fixtures';
import { setBinding } from './bindings';
import { createDocument } from './document';
import { setConfig } from './evaluator';
import { diffCount, setValue } from './layering';
import {
  applyRawJson,
  documentText,
  editRawJson,
  initRawJson,
  rawJsonStatus,
  readRawDocument,
  revertRawJson,
  syncRawFromForm,
} from './rawJson';
import { SecretStore } from './secrets';
import { buildSpec } from './spec';
import type { LaunchDocument } from './types';

const ctx = makeCtx();
const secrets = () => new SecretStore();

function doc(extra: Partial<LaunchDocument> = {}): LaunchDocument {
  return createDocument({
    environmentIds: [PRODUCTION],
    name: 'x',
    dataset: { mode: 'project', name: 'support-qa', ref: 'v:3', custom: '' },
    ...extra,
  });
}

function read(value: unknown, d = doc(), store = secrets(), c = ctx) {
  return readRawDocument(typeof value === 'string' ? value : JSON.stringify(value), d, c, store);
}

const errorsOf = (value: unknown, d = doc(), store = secrets()) =>
  read(value, d, store).errors.map((e) => `${e.pointer}: ${e.message}`);

describe('document -> text', () => {
  it('shows the §8.1 document with temporary-model keys as {"$secret": ref}', () => {
    const d = setBinding(doc(), ctx, 'endpoint:primary', {
      kind: 'temporary',
      model: 'm',
      secretRef: 'tmp-1',
      save: false,
      needsKey: false,
    });
    const text = documentText(d);
    expect(JSON.parse(text).slot_bindings['endpoint:primary']).toEqual({
      temporary: { model: 'm', api_key: { $secret: 'tmp-1' } },
    });
    expect(JSON.parse(text).evaluator).toEqual({ dataset: 'support-qa', dataset_version: '3' });
  });
});

describe('validation of the text', () => {
  it('rejects text that is not a JSON object', () => {
    expect(errorsOf('{oops')[0]).toMatch(/^: Invalid JSON: /);
    expect(errorsOf('[]')).toEqual([': The document must be a JSON object']);
    expect(errorsOf('null')).toEqual([': The document must be a JSON object']);
  });

  it('rejects unknown top-level keys and platform placeholders', () => {
    expect(errorsOf({ evaluator: { dataset: 'x' }, nope: 1 })).toEqual(['/nope: Unknown key']);
    expect(
      errorsOf({ evaluator: { dataset: 'x', config: { run_metadata: { a: '{{qym:model}}' } } } }),
    ).toContain('/evaluator/config/run_metadata/a: {{qym: is reserved for platform slot placeholders');
  });

  it('requires an evaluator object and rejects unknown or platform-owned evaluator keys', () => {
    expect(errorsOf({})).toEqual(['/evaluator: evaluator must be an object']);
    expect(errorsOf({ evaluator: { dataset: 'x', surprise: 1, model: 'gpt' } })).toEqual([
      '/evaluator/surprise: Unknown key',
      '/evaluator/model: model is set by the platform (from the primary model slot); remove it',
    ]);
  });

  it('checks dataset, dataset_version and report_k', () => {
    expect(errorsOf({ evaluator: { dataset: 3, report_k: 0 } })).toEqual([
      '/evaluator/dataset: Must be a string',
      '/evaluator/report_k: Must be a whole number ≥ 1',
    ]);
    expect(errorsOf({ evaluator: { dataset: { sweep: ['a', 'b'] } } })).toEqual([
      '/evaluator/dataset: The dataset cannot be swept in this form',
    ]);
  });

  it('checks the evaluation inputs against the evaluator schema', () => {
    const ev = (config: object) => ({ evaluator: { dataset: 'x', config } });
    expect(errorsOf(ev({ samples: 2 }))).toEqual([]);
    expect(errorsOf(ev({ samples: 'two' }))).toEqual(['/evaluator/config/samples: Must be a whole number']);
    expect(errorsOf(ev({ samples: 0 }))).toEqual(['/evaluator/config/samples: Must be at least 1']);
    expect(errorsOf(ev({ nope: 1 }))).toEqual([
      "/evaluator/config/nope: Not in the selected environments' evaluator schema",
    ]);
    expect(errorsOf(ev({ run_name: 'x' }))).toEqual([
      '/evaluator/config/run_name: run_name is set by the platform; remove it',
    ]);
    expect(errorsOf(ev({ run_name: null }))).toEqual([]);
    expect(errorsOf(ev({ run_metadata: { qym_x: 1, team: 'a' } }))).toEqual([
      '/evaluator/config/run_metadata/qym_x: Keys starting with qym_ are reserved for the platform',
    ]);
    expect(errorsOf(ev({ run_metadata: 3 }))).toEqual(['/evaluator/config/run_metadata: Must be an object']);
    expect(errorsOf(ev({ samples: { sweep: [1, 2] } }))).toEqual([]);
    expect(errorsOf(ev({ dataset_alias: { sweep: ['a'] } }))).toEqual([
      '/evaluator/config/dataset_alias: The dataset cannot be swept in this form',
    ]);
  });

  it('says so while the evaluation inputs are still loading', () => {
    const loading = makeCtx({ panel: null });
    expect(
      read({ evaluator: { dataset: 'x', config: { samples: 2 } } }, doc(), secrets(), loading).errors.map(
        (e) => e.message,
      ),
    ).toEqual(['The evaluation inputs are still loading; try again']);
  });

  it('uses the static wording when no environment supplied an evaluator schema', () => {
    const staticPanel = { ...evaluatorPanel, source: 'static' as const };
    const c = makeCtx({ panel: staticPanel });
    expect(
      read({ evaluator: { dataset: 'x', config: { nope: 1 } } }, doc(), secrets(), c).errors[0]?.message,
    ).toBe('Unknown key (EvaluatorRequestConfig rejects extra keys)');
  });

  it('validates env_overrides: unknown settings, types, bounds, roles, secrets and sweeps', () => {
    const env = (o: object) => ({ evaluator: { dataset: 'x' }, env_overrides: o });
    expect(errorsOf(env({ BRIEF_ENABLED: true, MILVUS_SEARCH_THRESHOLD: 0.5 }))).toEqual([]);
    expect(errorsOf(env({ NOPE: 1 }))).toEqual([
      '/env_overrides/NOPE: Unknown setting for the selected environments',
    ]);
    expect(errorsOf(env({ BRIEF_ENABLED: 'yes' }))).toEqual([
      '/env_overrides/BRIEF_ENABLED: Must be true or false',
    ]);
    expect(errorsOf(env({ MILVUS_SEARCH_THRESHOLD: 7 }))).toEqual([
      '/env_overrides/MILVUS_SEARCH_THRESHOLD: Must be at most 1',
    ]);
    expect(errorsOf(env({ LLM_OVERRIDES: { ghost_role: { temperature: 1 } } }))).toEqual([
      '/env_overrides/LLM_OVERRIDES/ghost_role/temperature: Unknown role for the selected environments',
    ]);
    expect(errorsOf(env({ LLM_OVERRIDES: { main: { temperature: 1 } } }))).toEqual([]);
    expect(errorsOf(env({ LLM_OVERRIDES: { endpoints: { primary: { api_key: 'sk-live' } } } }))).toEqual([
      '/env_overrides/LLM_OVERRIDES/endpoints/primary/api_key: Keys are never entered here: bind a model slot (project or temporary model) instead',
    ]);
    expect(errorsOf(env({ BRIEF_ENABLED: null }))).toEqual([]);
    expect(errorsOf(env({ MILVUS_SEARCH_THRESHOLD: { sweep: [0.1, 0.2] } }))).toEqual([]);
    expect(errorsOf(env({ MILVUS_SEARCH_THRESHOLD: { sweep: [] } }))).toEqual([
      '/env_overrides/MILVUS_SEARCH_THRESHOLD: A sweep needs a non-empty list of values',
    ]);
    expect(
      errorsOf(env({ LLM_OVERRIDES: { endpoints: { primary: { api_key: { sweep: ['a'] } } } } })),
    ).toEqual([
      '/env_overrides/LLM_OVERRIDES/endpoints/primary/api_key: Keys are never entered here: bind a model slot (project or temporary model) instead',
    ]);
    expect(errorsOf(env({ LLM_OVERRIDES: { sweep: [1] } }))[0]).toBe(
      '/env_overrides/LLM_OVERRIDES: Only a single setting can be swept',
    );
    expect(errorsOf({ evaluator: { dataset: 'x' }, env_overrides: [] })).toEqual([
      '/env_overrides: Must be an object',
    ]);
  });

  it('needs a loaded environment before env_overrides can be checked', () => {
    const empty = makeCtx({ envs: [makeEnv(PRODUCTION, 'p', { formError: 'down' })] });
    expect(
      read({ evaluator: { dataset: 'x' }, env_overrides: { BRIEF_ENABLED: true } }, doc(), secrets(), empty)
        .errors[0]?.message,
    ).toBe('Pick an environment (and wait for its settings) first');
  });

  it('refuses a raw value on a field a bound slot fills', () => {
    const body = {
      evaluator: { dataset: 'x' },
      slot_bindings: { 'endpoint:primary': { connection_id: 'c1' } },
      env_overrides: { LLM_OVERRIDES: { endpoints: { primary: { model: 'x', timeout: 3 } } } },
    };
    expect(errorsOf(body)).toEqual([
      '/env_overrides/LLM_OVERRIDES/endpoints/primary/model: Filled by the Primary model binding; remove this value or unbind the slot',
    ]);
  });
});

describe('model bindings in the text', () => {
  const bind = (b: unknown) => ({ evaluator: { dataset: 'x' }, slot_bindings: { 'endpoint:primary': b } });

  it('accepts project models, null and inherit', () => {
    expect(errorsOf(bind({ connection_id: 'c1' }))).toEqual([]);
    expect(errorsOf(bind({ connection_id: 'c1', name: 'n', model: 'm' }))).toEqual([]);
    expect(errorsOf(bind(null))).toEqual([]);
    expect(errorsOf(bind({ inherit: true }))).toEqual([]);
    expect(read(bind(null)).bindings).toEqual({});
  });

  it('rejects unknown slots, shapes and extra keys', () => {
    expect(
      errorsOf({ evaluator: { dataset: 'x' }, slot_bindings: { 'endpoint:ghost': { connection_id: 'c' } } }),
    ).toEqual(['/slot_bindings/endpoint:ghost: Unknown model slot for the selected environments']);
    expect(errorsOf(bind('x'))).toEqual([
      '/slot_bindings/endpoint:primary: Must be {"connection_id": …}, {"temporary": …} or null',
    ]);
    expect(errorsOf(bind({ connection_id: 'c', extra: 1 }))).toEqual([
      '/slot_bindings/endpoint:primary: Unknown binding keys: extra',
    ]);
    expect(errorsOf(bind({ connection_id: '' }))).toEqual([
      '/slot_bindings/endpoint:primary/connection_id: Must be a project model id',
    ]);
    expect(errorsOf({ evaluator: { dataset: 'x' }, slot_bindings: [] })).toEqual([
      '/slot_bindings: Must be an object',
    ]);
  });

  it('REFUSES a literal api key in a temporary model', () => {
    expect(errorsOf(bind({ temporary: { model: 'm', api_key: 'sk-live-abc' } }))).toEqual([
      '/slot_bindings/endpoint:primary/temporary/api_key: Keys are never typed into JSON: use "+ Temporary model" on the model card',
    ]);
    expect(
      errorsOf(bind({ temporary: { model: 'm', api_key: { $secret: 'x', extra: 'sk' } } })),
    ).toHaveLength(1);
    expect(errorsOf(bind({ temporary: { model: 'm', api_key: { value: 'sk-live' } } }))).toHaveLength(1);
    // never echoes the value
    for (const e of read(bind({ temporary: { model: 'm', api_key: 'sk-live-abc' } })).errors)
      expect(e.message).not.toContain('sk-live');
  });

  it('accepts only a key ref the SecretStore knows', () => {
    const body = bind({ temporary: { model: 'm', label: 'L', api_key: { $secret: 'tmp-1' } } });
    expect(errorsOf(body)).toEqual([
      '/slot_bindings/endpoint:primary/temporary/api_key: Unknown key reference: add the temporary model again to enter its key',
    ]);
    const store = secrets();
    store.put('k', 'tmp-1');
    const ok = read(body, doc(), store);
    expect(ok.errors).toEqual([]);
    expect(ok.bindings?.['endpoint:primary']).toEqual({
      kind: 'temporary',
      label: 'L',
      model: 'm',
      baseUrl: undefined,
      secretRef: 'tmp-1',
      save: false,
      needsKey: false,
    });
  });

  it('allows a temporary model without a key', () => {
    expect(errorsOf(bind({ temporary: { model: 'm' } }))).toEqual([]);
  });

  it('checks the temporary model shape', () => {
    expect(errorsOf(bind({ temporary: { model: 'm', color: 'red' } }))).toEqual([
      '/slot_bindings/endpoint:primary/temporary: Unknown temporary model keys: color',
    ]);
    expect(errorsOf(bind({ temporary: { label: 'x' } }))).toEqual([
      '/slot_bindings/endpoint:primary/temporary/model: A temporary model needs a model name',
    ]);
    expect(errorsOf(bind({ temporary: { model: 'm', base_url: 3 } }))).toEqual([
      '/slot_bindings/endpoint:primary/temporary: label and base_url must be strings',
    ]);
    expect(errorsOf(bind({ temporary: { model: 'm' }, connection_id: 'c' }))).toEqual([
      '/slot_bindings/endpoint:primary: Must be {"connection_id": …}, {"temporary": …} or null',
    ]);
  });

  it('keeps "save to project models" when the same temporary model stays bound', () => {
    const store = secrets();
    store.put('k', 'tmp-1');
    const d = setBinding(doc(), ctx, 'endpoint:primary', {
      kind: 'temporary',
      model: 'm',
      secretRef: 'tmp-1',
      save: true,
      needsKey: false,
    });
    const r = read(bind({ temporary: { model: 'm', api_key: { $secret: 'tmp-1' } } }), d, store);
    expect(r.bindings?.['endpoint:primary']).toMatchObject({ save: true });
  });

  it('accepts model sweeps and refuses empty or duplicate ones and literal keys inside', () => {
    expect(
      errorsOf(bind({ sweep: [{ connection_id: 'a' }, { connection_id: 'b' }, { inherit: true }] })),
    ).toEqual([]);
    expect(
      read(bind({ sweep: [{ connection_id: 'a' }, { inherit: true }] })).bindings?.['endpoint:primary'],
    ).toEqual({
      kind: 'sweep',
      items: [{ connection_id: 'a' }, { inherit: true }],
    });
    expect(errorsOf(bind({ sweep: [] }))).toEqual([
      '/slot_bindings/endpoint:primary: A sweep needs a non-empty list of models',
    ]);
    expect(errorsOf(bind({ sweep: [{ connection_id: 'a' }, { connection_id: 'a' }] }))).toEqual([
      '/slot_bindings/endpoint:primary/sweep/1: Duplicate model',
    ]);
    expect(errorsOf(bind({ sweep: [{ temporary: { model: 'm', api_key: 'sk-live' } }] }))).toEqual([
      '/slot_bindings/endpoint:primary/sweep/0/temporary/api_key: Keys are never typed into JSON: use "+ Temporary model" on the model card',
    ]);
  });
});

describe('links in the text', () => {
  const swept = {
    evaluator: { dataset: 'x' },
    env_overrides: { MILVUS_SEARCH_THRESHOLD: { sweep: [0.1, 0.2] }, SQL_RESULT_LIMIT: { sweep: [1, 2] } },
  };
  it('accepts links between swept values of equal length', () => {
    const r = read({
      ...swept,
      links: [['/env_overrides/MILVUS_SEARCH_THRESHOLD', '/env_overrides/SQL_RESULT_LIMIT']],
    });
    expect(r.errors).toEqual([]);
    expect(r.links).toEqual([['/env_overrides/MILVUS_SEARCH_THRESHOLD', '/env_overrides/SQL_RESULT_LIMIT']]);
  });
  it('rejects uneven or unswept links', () => {
    expect(
      errorsOf({
        ...swept,
        env_overrides: { MILVUS_SEARCH_THRESHOLD: { sweep: [0.1] }, SQL_RESULT_LIMIT: { sweep: [1, 2] } },
        links: [['/env_overrides/MILVUS_SEARCH_THRESHOLD', '/env_overrides/SQL_RESULT_LIMIT']],
      }),
    ).toEqual(['/links/0: Linked values need the same number of values (got 1, 2)']);
    expect(
      errorsOf({ ...swept, links: [['/env_overrides/BRIEF_ENABLED', '/env_overrides/SQL_RESULT_LIMIT']] })[0],
    ).toBe('/links/0/0: /env_overrides/BRIEF_ENABLED is not a swept value');
  });
});

describe('apply', () => {
  it('replaces settings, bindings, dataset and links and clears invalid text', () => {
    const store = secrets();
    const state = {
      ...initRawJson(doc(), evaluatorPanel),
      text: JSON.stringify({
        evaluator: {
          dataset: 'legal-set',
          dataset_version: '7',
          report_k: 4,
          config: { samples: 3, run_metadata: { team: 'a' } },
        },
        slot_bindings: { 'endpoint:primary': { connection_id: 'conn-prod' } },
        env_overrides: { BRIEF_ENABLED: true },
      }),
      dirty: true,
    };
    const r = applyRawJson(
      state,
      doc({ invalid: { '/SQL_RESULT_LIMIT': { message: 'x', raw: 'x' } } }),
      ctx,
      store,
    );
    expect(r.applied).toBe(true);
    expect(r.doc.dataset).toEqual({ mode: 'project', name: 'legal-set', ref: 'v:7', custom: '' });
    expect(r.doc.values).toEqual({ '/BRIEF_ENABLED': true });
    expect(r.doc.invalid).toEqual({});
    expect(r.doc.bindings).toEqual({ 'endpoint:primary': { kind: 'connection', id: 'conn-prod' } });
    expect(r.doc.evaluator.extra).toEqual({ report_k: 4 });
    expect(r.doc.evaluator.config).toEqual({ samples: 3 });
    expect(buildSpec(r.doc, evaluatorPanel)).toEqual({
      evaluator: {
        dataset: 'legal-set',
        dataset_version: '7',
        report_k: 4,
        config: { samples: 3, run_metadata: { team: 'a' } },
      },
      slot_bindings: { 'endpoint:primary': { connection_id: 'conn-prod' } },
      env_overrides: { BRIEF_ENABLED: true },
    });
    expect(rawJsonStatus(r.state)).toBe('in-sync');
  });

  it('maps an alias and a custom dataset string', () => {
    const alias = read({ evaluator: { dataset: 'legal-set', config: { dataset_alias: 'production' } } });
    const a = applyRawJson(
      {
        ...initRawJson(doc()),
        text: JSON.stringify({
          evaluator: { dataset: 'legal-set', config: { dataset_alias: 'production' } },
        }),
        dirty: true,
      },
      doc(),
      ctx,
      secrets(),
    );
    expect(alias.errors).toEqual([]);
    expect(a.doc.dataset.ref).toBe('a:production');
    expect(a.doc.evaluator.config).toEqual({});
    const c = applyRawJson(
      { ...initRawJson(doc()), text: JSON.stringify({ evaluator: { dataset: 'my own' } }), dirty: true },
      doc(),
      ctx,
      secrets(),
    );
    expect(c.doc.dataset).toEqual({ mode: 'custom', name: '', ref: '', custom: 'my own' });
  });

  it('clears a base input the text leaves out and drops base extras it omits', () => {
    const base = doc({ evaluatorExtra: { report_k: 5, config: { samples: 3, timeout: 60 } } });
    const text = JSON.stringify({ evaluator: { dataset: 'support-qa', config: { samples: 3 } } });
    const r = applyRawJson({ ...initRawJson(base, evaluatorPanel), text, dirty: true }, base, ctx, secrets());
    expect(r.doc.evaluator.config).toEqual({ timeout: null });
    expect(r.doc.evaluatorExtra).toEqual({ config: { samples: 3, timeout: 60 } });
    expect(buildSpec(r.doc, evaluatorPanel).evaluator).toEqual({
      dataset: 'support-qa',
      config: { samples: 3 },
    });
  });

  it('derives the global model back from the endpoints', () => {
    const body = {
      evaluator: { dataset: 'x' },
      slot_bindings: { 'endpoint:primary': { connection_id: 'c' } },
    };
    const r = applyRawJson(
      { ...initRawJson(doc()), text: JSON.stringify(body), dirty: true },
      doc(),
      ctx,
      secrets(),
    );
    expect(r.doc.globalModel).toEqual({ kind: 'connection', id: 'c' });
  });

  it('forgets keys no binding refers to any more', () => {
    const store = secrets();
    store.put('k', 'tmp-1');
    const d = setBinding(doc(), ctx, 'endpoint:primary', {
      kind: 'temporary',
      model: 'm',
      secretRef: 'tmp-1',
      save: false,
      needsKey: false,
    });
    const text = JSON.stringify({
      evaluator: { dataset: 'x' },
      slot_bindings: { 'endpoint:primary': { connection_id: 'c' } },
    });
    applyRawJson({ ...initRawJson(d), text, dirty: true }, d, ctx, store);
    expect(store.has('tmp-1')).toBe(false);
  });

  it('keeps the key of a temporary model that is still bound, round-tripping the form text', () => {
    const store = secrets();
    store.put('k', 'tmp-1');
    const d = setBinding(doc(), ctx, 'endpoint:primary', {
      kind: 'temporary',
      model: 'm',
      secretRef: 'tmp-1',
      save: false,
      needsKey: false,
    });
    const r = applyRawJson({ ...initRawJson(d, evaluatorPanel), dirty: true }, d, ctx, store);
    expect(r.applied).toBe(true);
    expect(store.has('tmp-1')).toBe(true);
    expect(r.doc.bindings['endpoint:primary']).toMatchObject({ secretRef: 'tmp-1' });
  });

  it('an unchanged form document applies as no change against the base', () => {
    const d = setConfig(
      setValue(doc({ evaluatorExtra: { config: { samples: 2 } } }), '/BRIEF_ENABLED', true),
      'timeout',
      9,
    );
    const r = applyRawJson({ ...initRawJson(d, evaluatorPanel), dirty: true }, d, ctx, secrets());
    expect(r.applied).toBe(true);
    expect(buildSpec(r.doc, evaluatorPanel)).toEqual(buildSpec(d, evaluatorPanel));
    expect(diffCount(r.doc).settings).toBe(diffCount(d).settings);
  });
});

describe('two-way sync status', () => {
  it('is in sync, then unapplied after an edit, then errors, then in sync again', () => {
    let state = initRawJson(doc(), evaluatorPanel);
    expect(rawJsonStatus(state)).toBe('in-sync');
    state = editRawJson(state, state.text + ' ');
    expect(rawJsonStatus(state)).toBe('unapplied');
    state = editRawJson(state, state.synced);
    expect(rawJsonStatus(state)).toBe('in-sync');
    const broken = applyRawJson(editRawJson(state, '{"evaluator": {"dataset": 3}}'), doc(), ctx, secrets());
    expect(broken.applied).toBe(false);
    expect(rawJsonStatus(broken.state)).toBe('errors');
    expect(broken.state.errors[0]).toEqual({ pointer: '/evaluator/dataset', message: 'Must be a string' });
    expect(broken.state.text).toBe('{"evaluator": {"dataset": 3}}'); // the text is kept
    const reverted = revertRawJson(doc(), evaluatorPanel);
    expect(rawJsonStatus(reverted)).toBe('in-sync');
  });

  it('form edits flow into the editor only while it has no unapplied text', () => {
    const d1 = doc();
    const state = initRawJson(d1, evaluatorPanel);
    const d2 = setValue(d1, '/BRIEF_ENABLED', true);
    const flowed = syncRawFromForm(state, d2, evaluatorPanel);
    expect(JSON.parse(flowed.text).env_overrides).toEqual({ BRIEF_ENABLED: true });
    expect(rawJsonStatus(flowed)).toBe('in-sync');
    const editing = editRawJson(state, '{"evaluator": {"dataset": "mine"}}');
    expect(syncRawFromForm(editing, d2, evaluatorPanel)).toBe(editing);
    expect(JSON.parse(syncRawFromForm(editing, d2, evaluatorPanel, true).text).env_overrides).toEqual({
      BRIEF_ENABLED: true,
    });
    expect(syncRawFromForm(state, d1, evaluatorPanel)).toBe(state);
  });

  it('leaving the editor without edits applies nothing', () => {
    const state = initRawJson(doc(), evaluatorPanel);
    const r = applyRawJson(state, doc(), ctx, secrets(), false);
    expect(r.applied).toBe(false);
    expect(r.state).toBe(state);
  });
});
