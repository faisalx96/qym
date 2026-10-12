import { describe, expect, it } from 'vitest';
import type { DescriptorEntry, EvalSlot, FormDescriptor } from '@/api/evalEnvironments';
import {
  candidatesFor,
  distributeSlotErrors,
  endpointCandidates,
  expandPointer,
  flatSlotFromField,
  freeFlatModels,
  initSlotState,
  keySets,
  slotReducer,
  slotsMissingModel,
  toPayload,
} from '../slotLogic';

const field = (
  pointer: string,
  name: string,
  type = 'string',
  extra: Partial<DescriptorEntry> = {},
): DescriptorEntry => ({
  pointer,
  name,
  kind: 'field',
  type,
  ...extra,
});

const descriptor: FormDescriptor = {
  root: ['/LLM_OVERRIDES', '/VIZ_LLM_MODEL', '/VIZ_LLM_BASE_URL', '/VIZ_LLM_TIMEOUT', '/CHART_LLM_MODEL'],
  groups: [],
  warnings: [],
  fields: {
    '/LLM_OVERRIDES': {
      pointer: '/LLM_OVERRIDES',
      name: 'LLM_OVERRIDES',
      kind: 'object',
      children: ['/LLM_OVERRIDES/endpoints'],
    },
    '/LLM_OVERRIDES/endpoints': {
      pointer: '/LLM_OVERRIDES/endpoints',
      name: 'endpoints',
      kind: 'collection',
      params: [],
      key_param: 'endpoint',
      item_pointer: '/LLM_OVERRIDES/endpoints/{endpoint}',
      children: ['/LLM_OVERRIDES/endpoints/{endpoint}'],
    },
    '/LLM_OVERRIDES/endpoints/{endpoint}': {
      pointer: '/LLM_OVERRIDES/endpoints/{endpoint}',
      name: 'endpoint',
      kind: 'object',
      children: [
        '/LLM_OVERRIDES/endpoints/{endpoint}/timeout',
        '/LLM_OVERRIDES/endpoints/{endpoint}/model',
        '/LLM_OVERRIDES/endpoints/{endpoint}/base_url',
      ],
    },
    '/LLM_OVERRIDES/endpoints/{endpoint}/timeout': field(
      '/LLM_OVERRIDES/endpoints/{endpoint}/timeout',
      'timeout',
      'integer',
    ),
    '/LLM_OVERRIDES/endpoints/{endpoint}/model': field('/LLM_OVERRIDES/endpoints/{endpoint}/model', 'model'),
    '/LLM_OVERRIDES/endpoints/{endpoint}/base_url': field(
      '/LLM_OVERRIDES/endpoints/{endpoint}/base_url',
      'base_url',
    ),
    '/VIZ_LLM_MODEL': field('/VIZ_LLM_MODEL', 'VIZ_LLM_MODEL'),
    '/VIZ_LLM_BASE_URL': field('/VIZ_LLM_BASE_URL', 'VIZ_LLM_BASE_URL'),
    '/VIZ_LLM_TIMEOUT': field('/VIZ_LLM_TIMEOUT', 'VIZ_LLM_TIMEOUT', 'integer'),
    '/CHART_LLM_MODEL': field('/CHART_LLM_MODEL', 'CHART_LLM_MODEL'),
  },
};

const primary: EvalSlot = {
  slot_key: 'endpoint:primary',
  kind: 'endpoint',
  label: 'Primary',
  field_map: {
    model: '/LLM_OVERRIDES/endpoints/primary/model',
    base_url: '/LLM_OVERRIDES/endpoints/primary/base_url',
    api_key: null,
  },
  transport_fields: { timeout: '/LLM_OVERRIDES/endpoints/primary/timeout' },
  extra_field_maps: [],
  required: true,
  status: 'confirmed',
};
const viz: EvalSlot = {
  slot_key: 'flat:VIZ_LLM',
  kind: 'flat',
  label: 'VIZ LLM model',
  field_map: { model: '/VIZ_LLM_MODEL', base_url: null, api_key: null },
  transport_fields: { timeout: '/VIZ_LLM_TIMEOUT' },
  extra_field_maps: [],
  required: false,
  status: 'proposed',
};

describe('descriptor helpers', () => {
  it('expands endpoint pointer templates with escaping', () => {
    expect(expandPointer('/A/{endpoint}/model', { endpoint: 'fast/v2' })).toBe('/A/fast~1v2/model');
  });
  it('lists endpoint candidates for a role, best name first', () => {
    // Any string field fits the model role; the one named `model` comes first.
    expect(endpointCandidates(descriptor, 'fast', 'model')[0]).toBe('/LLM_OVERRIDES/endpoints/fast/model');
    expect(endpointCandidates(descriptor, 'fast', 'base_url')[0]).toBe(
      '/LLM_OVERRIDES/endpoints/fast/base_url',
    );
    expect(endpointCandidates(descriptor, 'fast', 'model')).not.toContain(
      '/LLM_OVERRIDES/endpoints/fast/timeout',
    );
  });
  it('offers only unassigned flat model fields', () => {
    const state = initSlotState([primary, viz]);
    const free = freeFlatModels(state.slots, descriptor);
    expect(free[0]).toBe('/CHART_LLM_MODEL');
    expect(free).not.toContain('/VIZ_LLM_MODEL');
  });
  it('excludes pointers used by another slot from candidates', () => {
    const state = initSlotState([primary, viz]);
    const slot = state.slots[1]!;
    const options = candidatesFor(state.slots, descriptor, slot, 'model', 1);
    expect(options[0]).toBe('/CHART_LLM_MODEL');
    expect(options).not.toContain('/VIZ_LLM_MODEL');
  });
});

describe('slot reducer', () => {
  it('renames and clears the slot errors', () => {
    let s = initSlotState([primary]);
    s = slotReducer(s, { type: 'setErrors', errors: { 'endpoint:primary': ['bad'] }, general: 'x' });
    s = slotReducer(s, {
      type: 'setRole',
      slotKey: 'endpoint:primary',
      setIdx: 0,
      role: 'api_key',
      pointer: '/k',
    });
    expect(s.errors['endpoint:primary']).toBeUndefined();
    expect(s.slots[0]!.field_map.api_key).toBe('/k');
    s = slotReducer(s, { type: 'rename', slotKey: 'endpoint:primary', label: 'Main' });
    expect(s.slots[0]!.label).toBe('Main');
  });

  it('adds and removes extra key sets (set 0 is the field map)', () => {
    let s = initSlotState([viz]);
    s = slotReducer(s, { type: 'addSet', slotKey: 'flat:VIZ_LLM' });
    s = slotReducer(s, {
      type: 'setRole',
      slotKey: 'flat:VIZ_LLM',
      setIdx: 1,
      role: 'model',
      pointer: '/CHART_LLM_MODEL',
    });
    expect(keySets(s.slots[0]!)).toHaveLength(2);
    expect(slotsMissingModel(s.slots)).toHaveLength(0);
    s = slotReducer(s, { type: 'removeSet', slotKey: 'flat:VIZ_LLM', setIdx: 1 });
    expect(keySets(s.slots[0]!)).toHaveLength(1);
  });

  it('flags a key set without a model field', () => {
    const s = slotReducer(initSlotState([viz]), { type: 'addSet', slotKey: 'flat:VIZ_LLM' });
    expect(slotsMissingModel(s.slots).map((x) => x.slot_key)).toEqual(['flat:VIZ_LLM']);
  });

  it('unmaps a transport chip', () => {
    const s = slotReducer(initSlotState([viz]), { type: 'detach', slotKey: 'flat:VIZ_LLM', name: 'timeout' });
    expect(s.slots[0]!.transport_fields).toEqual({});
  });

  it('never removes a required slot, can restore an optional one', () => {
    let s = initSlotState([primary, viz]);
    expect(slotReducer(s, { type: 'remove', slotKey: 'endpoint:primary' }).slots).toHaveLength(2);
    s = slotReducer(s, { type: 'remove', slotKey: 'flat:VIZ_LLM' });
    expect(s.slots.map((x) => x.slot_key)).toEqual(['endpoint:primary']);
    expect(s.removed).toHaveLength(1);
    s = slotReducer(s, { type: 'restore', slotKey: 'flat:VIZ_LLM' });
    expect(s.slots.map((x) => x.slot_key)).toEqual(['endpoint:primary', 'flat:VIZ_LLM']);
    expect(s.removed).toHaveLength(0);
  });

  it('restore drops fields another slot claimed meanwhile', () => {
    let s = initSlotState([primary, viz]);
    s = slotReducer(s, { type: 'remove', slotKey: 'flat:VIZ_LLM' });
    const grabbing = flatSlotFromField(s.slots, descriptor, '/CHART_LLM_MODEL');
    if ('error' in grabbing) throw new Error(grabbing.error);
    grabbing.transport_fields = { timeout: '/VIZ_LLM_TIMEOUT' };
    s = slotReducer(s, { type: 'addSlot', slot: grabbing });
    s = slotReducer(s, { type: 'restore', slotKey: 'flat:VIZ_LLM' });
    const restored = s.slots.find((x) => x.slot_key === 'flat:VIZ_LLM')!;
    expect(restored.field_map.model).toBe('/VIZ_LLM_MODEL');
    expect(restored.transport_fields).toEqual({});
  });

  it('merges a slot into another as an extra key set and keeps transport conflicts out', () => {
    const chart: EvalSlot = {
      ...viz,
      slot_key: 'flat:CHART_LLM',
      label: 'Chart',
      field_map: { model: '/CHART_LLM_MODEL', base_url: null, api_key: null },
      transport_fields: { timeout: '/CHART_LLM_TIMEOUT', max_attempts: '/CHART_MAX' },
    };
    let s = initSlotState([viz, chart]);
    s = slotReducer(s, { type: 'merge', srcKey: 'flat:CHART_LLM', dstKey: 'flat:VIZ_LLM' });
    expect(s.slots).toHaveLength(1);
    const dst = s.slots[0]!;
    expect(dst.extra_field_maps[0]!.model).toBe('/CHART_LLM_MODEL');
    expect(dst.transport_fields).toEqual({ timeout: '/VIZ_LLM_TIMEOUT', max_attempts: '/CHART_MAX' });
    expect(s.notice).toContain('/CHART_LLM_TIMEOUT');
  });

  it('builds a flat group from a model field and pulls in related fields', () => {
    const slot = flatSlotFromField([], descriptor, '/VIZ_LLM_MODEL');
    if ('error' in slot) throw new Error(slot.error);
    expect(slot.slot_key).toBe('flat:VIZ_LLM');
    expect(slot.field_map.base_url).toBe('/VIZ_LLM_BASE_URL');
    expect(slot.transport_fields.timeout).toBe('/VIZ_LLM_TIMEOUT');
    expect(slot.label).toBe('VIZ LLM model');
  });

  it('refuses a duplicate flat group', () => {
    const state = initSlotState([viz]);
    expect(flatSlotFromField(state.slots, descriptor, '/VIZ_LLM_MODEL')).toEqual({
      error: 'A slot flat:VIZ_LLM already exists.',
    });
  });

  it('builds the PUT payload with trimmed labels', () => {
    const s = slotReducer(initSlotState([viz]), {
      type: 'rename',
      slotKey: 'flat:VIZ_LLM',
      label: '  Viz  ',
    });
    expect(toPayload(s.slots)[0]).toMatchObject({ slot_key: 'flat:VIZ_LLM', kind: 'flat', label: 'Viz' });
  });
});

describe('server error distribution', () => {
  it('maps 422 errors onto slot cards and the rest to a general message', () => {
    const s = initSlotState([primary, viz]);
    const r = distributeSlotErrors(s.slots, [
      { slot_key: 'flat:VIZ_LLM', message: 'model missing' },
      { message: 'schema too old' },
    ]);
    expect(r.errors).toEqual({ 'flat:VIZ_LLM': ['model missing'] });
    expect(r.general).toBe('schema too old');
    expect(distributeSlotErrors(s.slots, [{ slot_key: 'flat:VIZ_LLM', message: 'm' }]).general).toMatch(
      /Fix the highlighted/,
    );
  });
});
