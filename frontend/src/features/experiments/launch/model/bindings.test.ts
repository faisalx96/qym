import { describe, expect, it } from 'vitest';
import { makeCtx, makeEnv, PRODUCTION } from './__fixtures__/fixtures';
import {
  addExtraEndpoints,
  bindingKey,
  bindingsNeedingKey,
  bindingSecretRefs,
  bindingSummary,
  bindingToSpec,
  boundPointers,
  commonEndpointBinding,
  deriveGlobalModel,
  docSecretRefs,
  followsGlobal,
  globalSummary,
  inheritEverywhere,
  rawEndpointNames,
  reenterKey,
  removeExtraEndpoint,
  setBinding,
  setGlobalModel,
  slotPointer,
  temporaryBinding,
  unconfirmedEndpoints,
  validateEndpointName,
} from './bindings';
import { createDocument } from './document';
import { SecretStore } from './secrets';
import type { FormContext, ModelSlot, SlotBinding } from './types';

const proposal = (name: string): ModelSlot => ({
  slot_key: `endpoint:${name}`,
  kind: 'endpoint',
  label: `${name} model`,
  field_map: {
    model: `/LLM_OVERRIDES/endpoints/${name}/model`,
    base_url: `/LLM_OVERRIDES/endpoints/${name}/base_url`,
    api_key: `/LLM_OVERRIDES/endpoints/${name}/api_key`,
  },
});

/** primary + fast endpoints (fast is this-experiment only) and the flat VIZ slot. */
function ctxWithFast(extra = ['fast']): FormContext {
  const env = makeEnv(PRODUCTION, 'production');
  env.extra = { fast: proposal('fast') };
  return makeCtx({ envs: [env], extraEndpoints: extra });
}

const conn = (id: string): SlotBinding => ({ kind: 'connection', id });
const temp = (ref: string | null = 'tmp-1'): SlotBinding => ({
  kind: 'temporary',
  model: 'gpt-x',
  label: 'X',
  baseUrl: 'https://x',
  secretRef: ref,
  save: false,
  needsKey: !ref,
});

describe('spec conversion', () => {
  it('writes connections, temporary models (ref only) and sweeps', () => {
    expect(bindingToSpec(conn('c1'))).toEqual({ connection_id: 'c1' });
    expect(bindingToSpec(temp())).toEqual({
      temporary: { model: 'gpt-x', label: 'X', base_url: 'https://x', api_key: { $secret: 'tmp-1' } },
    });
    expect(bindingToSpec(temp(null))).toEqual({
      temporary: { model: 'gpt-x', label: 'X', base_url: 'https://x' },
    });
    expect(bindingToSpec({ kind: 'sweep', items: [{ connection_id: 'a' }, { inherit: true }] })).toEqual({
      sweep: [{ connection_id: 'a' }, { inherit: true }],
    });
  });

  it('compares bindings without the key ref', () => {
    expect(bindingKey(temp('a'))).toBe(bindingKey(temp('b')));
    expect(bindingKey(conn('x'))).not.toBe(bindingKey(conn('y')));
    expect(bindingKey(null)).toBe('');
  });

  it('collects refs under bindings and sweeps', () => {
    expect(bindingSecretRefs(temp('r1'))).toEqual(['r1']);
    expect(
      bindingSecretRefs({
        kind: 'sweep',
        items: [{ temporary: { model: 'm', api_key: { $secret: 'r2' } } }, { connection_id: 'c' }],
      }),
    ).toEqual(['r2']);
    expect(bindingSecretRefs(conn('c'))).toEqual([]);
  });
});

describe('binding a slot', () => {
  const ctx = makeCtx();

  it('drops raw values under the slot (binding_conflict) and locks the pointers', () => {
    const doc = createDocument({
      values: {
        '/LLM_OVERRIDES/endpoints/primary/model': 'old',
        '/LLM_OVERRIDES/endpoints/primary/timeout': 30,
      },
      invalid: { '/LLM_OVERRIDES/endpoints/primary/base_url': { message: 'x', raw: 'x' } },
    });
    const next = setBinding(doc, ctx, 'endpoint:primary', conn('conn-prod'));
    expect(next.values).toEqual({ '/LLM_OVERRIDES/endpoints/primary/timeout': 30 });
    expect(next.invalid).toEqual({});
    const bound = boundPointers(next, ctx);
    expect(bound['/LLM_OVERRIDES/endpoints/primary/model']).toBe('Primary model');
    expect(bound['/LLM_OVERRIDES/endpoints/primary/timeout']).toBeUndefined();
    expect(doc.values['/LLM_OVERRIDES/endpoints/primary/model']).toBe('old'); // pure
  });

  it('forgets keys no binding uses any more', () => {
    const secrets = new SecretStore();
    secrets.put('k1', 'tmp-1');
    let doc = setBinding(createDocument(), ctx, 'endpoint:primary', temp('tmp-1'), secrets);
    expect(secrets.has('tmp-1')).toBe(true);
    doc = setBinding(doc, ctx, 'endpoint:primary', null, secrets);
    expect(secrets.has('tmp-1')).toBe(false);
    expect(doc.bindings).toEqual({});
  });

  it('asks again for the key of a temporary model that came without one', () => {
    let doc = createDocument({ bindings: { 'endpoint:primary': temp(null) } });
    expect(bindingsNeedingKey(doc, ctx)).toEqual([{ slotKey: 'endpoint:primary', label: 'Primary model' }]);
    doc = reenterKey(doc, 'endpoint:primary', 'tmp-9');
    expect(bindingsNeedingKey(doc, ctx)).toEqual([]);
    expect(docSecretRefs(doc)).toEqual(new Set(['tmp-9']));
  });

  it('summarises a binding for the review panel', () => {
    const doc = createDocument({
      bindings: { 'endpoint:primary': conn('conn-mini'), 'flat:VIZ_LLM': temp() },
    });
    expect(bindingSummary(doc, ctx, 'endpoint:primary')).toBe('gpt-4o mini');
    expect(bindingSummary(doc, ctx, 'flat:VIZ_LLM')).toBe('Temporary: X');
    expect(bindingSummary(doc, ctx, 'nothing')).toBe('Inherit');
    expect(
      bindingSummary(
        { ...doc, bindings: { a: { kind: 'sweep', items: [{ connection_id: 'x' }] } } },
        ctx,
        'a',
      ),
    ).toBe('Sweep of 1 model');
  });

  it('builds a temporary binding from the form result', () => {
    expect(temporaryBinding({ model: 'm', secretRef: 'r' })).toMatchObject({
      kind: 'temporary',
      secretRef: 'r',
      needsKey: false,
      save: false,
    });
  });
});

describe('global model (B22)', () => {
  const ctx = ctxWithFast();

  it('binds every endpoint but not flat slots, dropping their raw values', () => {
    const doc = createDocument({
      extraEndpoints: ['fast'],
      values: { '/LLM_OVERRIDES/endpoints/fast/model': 'raw', '/VIZ_LLM_MODEL': 'viz' },
    });
    const next = setGlobalModel(doc, ctx, conn('conn-prod'));
    expect(Object.keys(next.bindings).sort()).toEqual(['endpoint:fast', 'endpoint:primary']);
    expect(next.values).toEqual({ '/VIZ_LLM_MODEL': 'viz' });
    expect(globalSummary(next, ctx)).toMatchObject({ total: 2, custom: [] });
  });

  it('tags diverged endpoints as custom and a later global change overwrites them', () => {
    let doc = setGlobalModel(createDocument({ extraEndpoints: ['fast'] }), ctx, conn('conn-prod'));
    doc = setBinding(doc, ctx, 'endpoint:fast', conn('conn-mini'));
    const summary = globalSummary(doc, ctx);
    expect(summary.following.map((s) => s.slot_key)).toEqual(['endpoint:primary']);
    expect(summary.custom.map((s) => s.slot_key)).toEqual(['endpoint:fast']);
    expect(followsGlobal(doc, 'endpoint:fast')).toBe(false);
    doc = setGlobalModel(doc, ctx, conn('conn-mini'));
    expect(globalSummary(doc, ctx).custom).toEqual([]);
    expect(doc.bindings['endpoint:primary']).toEqual(conn('conn-mini'));
  });

  it('clearing forgets only the global value', () => {
    let doc = setGlobalModel(createDocument({ extraEndpoints: ['fast'] }), ctx, conn('conn-prod'));
    doc = setGlobalModel(doc, ctx, null);
    expect(doc.globalModel).toBeNull();
    expect(doc.bindings['endpoint:primary']).toEqual(conn('conn-prod'));
  });

  it('derives the global model back when every endpoint shares one binding', () => {
    const doc = createDocument({
      extraEndpoints: ['fast'],
      bindings: { 'endpoint:primary': conn('c'), 'endpoint:fast': conn('c') },
    });
    expect(deriveGlobalModel(doc, ctx).globalModel).toEqual(conn('c'));
    const mixed = { ...doc, bindings: { 'endpoint:primary': conn('c'), 'endpoint:fast': conn('d') } };
    expect(deriveGlobalModel(mixed, ctx).globalModel).toBeNull();
    const partial = { ...doc, bindings: { 'endpoint:primary': conn('c') } };
    expect(deriveGlobalModel(partial, ctx).globalModel).toBeNull();
  });

  it('shares one key ref across endpoints and keeps it while another binding uses it', () => {
    const secrets = new SecretStore();
    secrets.put('K', 'tmp-g');
    let doc = setGlobalModel(createDocument({ extraEndpoints: ['fast'] }), ctx, temp('tmp-g'), secrets);
    expect(docSecretRefs(doc)).toEqual(new Set(['tmp-g']));
    doc = setBinding(doc, ctx, 'endpoint:fast', null, secrets);
    expect(secrets.has('tmp-g')).toBe(true); // primary and the global model still use it
    doc = inheritEverywhere(doc, ctx, secrets);
    expect(secrets.has('tmp-g')).toBe(false);
    expect(doc.globalModel).toBeNull();
  });

  it('a global temporary model without a key asks once, not per endpoint', () => {
    const doc = setGlobalModel(createDocument({ extraEndpoints: ['fast'] }), ctx, temp(null));
    expect(bindingsNeedingKey(doc, ctx)).toEqual([{ slotKey: null, label: 'Global model' }]);
  });

  it('a global model sweep links every endpoint into one axis', () => {
    const sweep: SlotBinding = { kind: 'sweep', items: [{ connection_id: 'a' }, { connection_id: 'b' }] };
    const doc = setGlobalModel(createDocument({ extraEndpoints: ['fast'] }), ctx, sweep);
    expect(doc.links).toEqual([[slotPointer('endpoint:primary'), slotPointer('endpoint:fast')]]);
    expect(commonEndpointBinding(doc, ctx)).toEqual(sweep);
    // unlinked identical sweeps are a grid, not a global sweep
    expect(commonEndpointBinding({ ...doc, links: undefined }, ctx)).toBeNull();
  });

  it('new endpoints start on the global model', () => {
    let doc = setGlobalModel(createDocument(), ctx, conn('conn-prod'));
    doc = addExtraEndpoints(doc, ctx, ['fast']);
    expect(doc.extraEndpoints).toEqual(['fast']);
    expect(doc.bindings['endpoint:fast']).toEqual(conn('conn-prod'));
    expect(addExtraEndpoints(doc, ctx, ['fast'])).toBe(doc);
  });

  it('removing an extra endpoint unbinds it', () => {
    let doc = setGlobalModel(createDocument({ extraEndpoints: ['fast'] }), ctx, conn('conn-prod'));
    doc = removeExtraEndpoint(doc, 'fast');
    expect(doc.extraEndpoints).toEqual([]);
    expect(doc.bindings['endpoint:fast']).toBeUndefined();
  });

  it('lists endpoints that only have raw values, so they can be added first', () => {
    const c = makeCtx();
    const doc = createDocument({
      values: { '/LLM_OVERRIDES/endpoints/judge/model': 'x', '/LLM_OVERRIDES/endpoints/primary/model': 'y' },
      addedKeys: { '/LLM_OVERRIDES/endpoints': ['newone'] },
    });
    expect(rawEndpointNames(doc, c)).toEqual(['judge', 'newone']);
  });
});

describe('extra endpoints', () => {
  it('names the endpoint slots of a config no environment has confirmed', () => {
    const c = makeCtx();
    expect(
      unconfirmedEndpoints(
        {
          slot_bindings: {
            'endpoint:fast': { connection_id: 'x' },
            'endpoint:primary': null,
            'flat:VIZ_LLM': null,
          },
        },
        c,
      ),
    ).toEqual(['fast']);
    expect(unconfirmedEndpoints(null, c)).toEqual([]);
  });

  it('validates a new endpoint name', () => {
    const c = makeCtx();
    const coll = { key_pattern: null };
    expect(validateEndpointName('', coll, c.slots)).toBe('Enter a name.');
    expect(validateEndpointName('bad name', coll, c.slots)).toBe('Use letters, digits, ".", "_" or "-".');
    expect(validateEndpointName('primary', coll, c.slots)).toBe('Already present.');
    expect(validateEndpointName('fast', coll, c.slots)).toBeNull();
    expect(validateEndpointName('x', { key_pattern: '^[a-z]{3}$' }, c.slots)).toBe('Invalid name.');
  });
});
