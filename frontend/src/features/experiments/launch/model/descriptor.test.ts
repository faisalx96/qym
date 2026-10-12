import { describe, expect, it } from 'vitest';
import {
  entry,
  makeCtx,
  makeEnv,
  PRODUCTION,
  STAGING,
  twoEnvCtx,
  withSynthetic,
} from './__fixtures__/fixtures';
import {
  acceptsText,
  buildUnionSlots,
  editEntry,
  endpointsCollection,
  enumOptions,
  envsMissing,
  fitsWidget,
  formatInput,
  globalConnections,
  hintText,
  jsonFallback,
  leafKind,
  leafSchema,
  missingFrom,
  notInEnvMessage,
  parseInput,
  rawInputSchema,
  slotConnections,
  temporaryKeysAllowed,
  unmatchedPointers,
  validateLeafValue,
} from './descriptor';

const ctx = makeCtx();
const f = ctx.union.fields;
const e = (p: string) => f[p] as NonNullable<(typeof f)[string]>;

describe('union across environments', () => {
  it('keeps presence per pointer and tags what an environment lacks', () => {
    const two = twoEnvCtx();
    expect(two.union.envs).toEqual([PRODUCTION, STAGING]);
    expect(missingFrom(two.union, '/VIZ_MAX_GROUPS')).toEqual([STAGING]);
    expect(missingFrom(two.union, '/STAGING_ONLY_FLAG')).toEqual([PRODUCTION]);
    expect(missingFrom(two.union, '/BRIEF_ENABLED')).toEqual([]);
    expect(missingFrom(ctx.union, '/VIZ_MAX_GROUPS')).toEqual([]);
  });

  it('merges groups and role rows', () => {
    const two = twoEnvCtx();
    const misc = two.union.groups.find((g) => g.id === 'misc');
    expect(misc?.pointers).toContain('/STAGING_ONLY_FLAG');
    expect(misc?.pointers).toContain('/REQUEST_TIMEOUT');
  });

  it('reports environments whose schema has no entry for a concrete pointer', () => {
    const two = twoEnvCtx();
    expect(envsMissing(two.envs, '/VIZ_MAX_GROUPS')).toEqual([STAGING]);
    expect(envsMissing(two.envs, '/LLM_OVERRIDES/endpoints/primary/model')).toEqual([]);
    expect(notInEnvMessage('/VIZ_MAX_GROUPS', 'staging')).toBe(
      'VIZ_MAX_GROUPS is not in environment "staging": reset it or deselect staging.',
    );
  });

  it('does not union an environment that has no form', () => {
    const c = makeCtx({
      envs: [makeEnv(PRODUCTION, 'production'), makeEnv(STAGING, 'staging', { formError: 'down' })],
    });
    expect(c.union.envs).toEqual([PRODUCTION]);
    expect(c.envs[1]?.formError).toBe('down');
  });
});

describe('model slots', () => {
  it('unions confirmed slots with the primary endpoint first and the pointers they fill', () => {
    const slots = ctx.slots;
    expect(slots.map((s) => s.slot_key)).toEqual(['endpoint:primary', 'flat:VIZ_LLM']);
    expect(slots[0]?.pointers).toContain('/LLM_OVERRIDES/endpoints/primary/model');
    expect(slots[0]?.pointers).toContain('/LLM_OVERRIDES/endpoints/primary/api_key');
    expect(slots[1]?.field_map).toEqual({ model: '/VIZ_LLM_MODEL' });
  });

  it('adds extra endpoints only where the server proposed a slot', () => {
    const proposal = {
      slot_key: 'endpoint:fast',
      kind: 'endpoint' as const,
      label: 'fast model',
      field_map: {
        model: '/LLM_OVERRIDES/endpoints/fast/model',
        base_url: '/LLM_OVERRIDES/endpoints/fast/base_url',
        api_key: '/LLM_OVERRIDES/endpoints/fast/api_key',
      },
    };
    const a = makeEnv(PRODUCTION, 'production');
    a.extra = { fast: proposal, nope: null };
    const slots = buildUnionSlots([a], ['fast', 'nope']);
    const fast = slots.find((s) => s.slot_key === 'endpoint:fast');
    expect(fast?.extra).toBe(true);
    expect(slots.some((s) => s.slot_key === 'endpoint:nope')).toBe(false);
  });

  it('marks a model usable only where every environment allows it', () => {
    const blocked = makeEnv(STAGING, 'staging');
    const first = blocked.options?.connections[0];
    if (first?.slots) first.slots['endpoint:primary'] = { available: false, reason: 'Wrong base URL' };
    const c = makeCtx({ envs: [makeEnv(PRODUCTION, 'production'), blocked] });
    const primary = c.slots[0]!;
    const list = slotConnections(c, primary);
    const prod = list.find((x) => x.id === 'conn-prod')!;
    expect(prod.available).toBe(false);
    expect(prod.reasons[0]).toContain('Wrong base URL (staging)');
    expect(list.find((x) => x.id === 'conn-mini')?.available).toBe(true);
    const globals = globalConnections(
      c,
      c.slots.filter((s) => s.kind === 'endpoint'),
    );
    expect(globals.find((x) => x.id === 'conn-mini')?.available).toBe(true);
  });

  it('collects the temporary-key policy over the environments', () => {
    const noKeys = makeEnv(STAGING, 'staging');
    if (noKeys.options) {
      noKeys.options.temporary_keys_allowed = false;
      noKeys.options.temporary_keys_reason = 'Keys are not sent here';
    }
    const c = makeCtx({ envs: [makeEnv(PRODUCTION, 'production'), noKeys] });
    expect(temporaryKeysAllowed(c)).toEqual({ allowed: false, reason: 'Keys are not sent here (staging)' });
    expect(temporaryKeysAllowed(ctx)).toEqual({ allowed: true, reason: null });
  });

  it('finds the endpoints collection', () => {
    expect(endpointsCollection(ctx.union)?.pointer).toBe('/LLM_OVERRIDES/endpoints');
  });
});

describe('leaf classification', () => {
  it('classifies the sample descriptor entries', () => {
    expect(leafKind(e('/BRIEF_ENABLED'))).toBe('boolean');
    expect(leafKind(e('/TABLE_SELECTION_MODE'))).toBe('enum');
    expect(leafKind(e('/LLM_OVERRIDES/{role}/endpoint'))).toBe('endpoint-ref');
    expect(leafKind(e('/LLM_OVERRIDES/endpoints/{endpoint}/api_key'))).toBe('secret');
    expect(leafKind(e('/SQL_RESULT_LIMIT'))).toBe('number');
    expect(leafKind(e('/RAG_ITERATION'))).toBe('text');
  });

  it('classifies json, array and object entries', () => {
    expect(leafKind(entry({ pointer: '/a', type: 'json' }))).toBe('json');
    expect(leafKind(entry({ pointer: '/a', type: 'array' }))).toBe('array');
    expect(leafKind(entry({ pointer: '/a', type: 'object' }))).toBe('object');
  });
});

describe('values that do not fit the widget (B20)', () => {
  const number = e('/SQL_RESULT_LIMIT');
  it('falls back to JSON for an object in a number field', () => {
    expect(fitsWidget(number, { a: 1 })).toBe(false);
    const edit = editEntry(number, { a: 1 });
    expect(edit.type).toBe('json');
    expect(edit.fallback).toBe('integer');
    expect(hintText(edit)).toContain('not a integer');
  });

  it('keeps the field when the value fits, unset, sweeps and secrets', () => {
    expect(editEntry(number, 5)).toBe(number);
    expect(editEntry(number, undefined)).toBe(number);
    expect(fitsWidget(number, { sweep: [1, 2] })).toBe(true);
    expect(fitsWidget(e('/LLM_OVERRIDES/endpoints/{endpoint}/api_key'), { x: 1 })).toBe(true);
    expect(fitsWidget(e('/TABLE_SELECTION_MODE'), 'nope')).toBe(false);
    expect(fitsWidget(e('/BRIEF_ENABLED'), 'yes')).toBe(false);
  });

  it('stays JSON after the user typed invalid JSON for a fallback', () => {
    expect(editEntry(number, undefined, { json: true }).fallback).toBe('integer');
    expect(editEntry(number, undefined, { json: false })).toBe(number);
    expect(jsonFallback(jsonFallback(number)).fallback).toBe('integer');
  });
});

describe('parseInput', () => {
  it('treats empty text as unset', () => {
    for (const p of ['/BRIEF_ENABLED', '/SQL_RESULT_LIMIT', '/RAG_ITERATION', '/TABLE_SELECTION_MODE']) {
      expect(parseInput(e(p), '')).toEqual({ unset: true });
    }
  });

  it('parses booleans, enum indexes, numbers and text', () => {
    expect(parseInput(e('/BRIEF_ENABLED'), 'false')).toEqual({ value: false });
    expect(parseInput(e('/TABLE_SELECTION_MODE'), '1')).toEqual({ value: 'llm_direct' });
    expect(enumOptions(e('/TABLE_SELECTION_MODE')).map((o) => o.value)).toEqual(['0', '1', '2']);
    expect(parseInput(e('/SQL_RESULT_LIMIT'), ' 25 ')).toEqual({ value: 25 });
    expect(parseInput(e('/SQL_RESULT_LIMIT'), '2.5')).toEqual({ error: 'Enter a whole number' });
    expect(parseInput(e('/MILVUS_SEARCH_THRESHOLD'), 'abc')).toEqual({ error: 'Enter a number' });
    expect(parseInput(e('/RAG_ITERATION'), 'latest')).toEqual({ value: 'latest' });
    expect(parseInput(e('/LLM_OVERRIDES/{role}/endpoint'), 'fast')).toEqual({ value: 'fast' });
  });

  it('keeps non-JSON text as a string only for json fields that accept strings', () => {
    const open = entry({ pointer: '/a', type: 'json', accepts: null });
    const numeric = entry({ pointer: '/b', type: 'json', accepts: ['integer'] });
    expect(parseInput(open, '{"a":1}')).toEqual({ value: { a: 1 } });
    expect(parseInput(open, 'hello')).toEqual({ value: 'hello' });
    expect(parseInput(open, '{oops')).toEqual({ error: 'Enter valid JSON' });
    expect(parseInput(open, '"unterminated')).toEqual({ error: 'Enter valid JSON' });
    expect(parseInput(numeric, 'hello')).toEqual({ error: 'Enter valid JSON' });
    expect(acceptsText(jsonFallback(e('/SQL_RESULT_LIMIT')), 'hello')).toBe(false);
  });

  it('formats a value back to control text', () => {
    expect(formatInput(e('/BRIEF_ENABLED'), true)).toBe('true');
    expect(formatInput(e('/TABLE_SELECTION_MODE'), 'pure_llm')).toBe('2');
    expect(formatInput(e('/SQL_RESULT_LIMIT'), 5)).toBe('5');
    expect(formatInput(e('/SQL_RESULT_LIMIT'), undefined)).toBe('');
    expect(formatInput(e('/SQL_RESULT_LIMIT'), 5, 'abc')).toBe('abc');
    expect(formatInput(entry({ pointer: '/j', type: 'json' }), { a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('leafSchema (zod from type / bounds / enum / pattern / accepts)', () => {
  it('checks numeric bounds', () => {
    expect(validateLeafValue(e('/MILVUS_SEARCH_THRESHOLD'), 0.5)).toBeNull();
    expect(validateLeafValue(e('/MILVUS_SEARCH_THRESHOLD'), 1.5)).toBe('Must be at most 1');
    expect(validateLeafValue(e('/MILVUS_SEARCH_THRESHOLD'), -1)).toBe('Must be at least 0');
    expect(validateLeafValue(e('/REQUEST_TIMEOUT'), 0)).toBe('Must be greater than 0');
    expect(validateLeafValue(e('/SQL_RESULT_LIMIT'), 1.5)).toBe('Must be a whole number');
    expect(validateLeafValue(e('/SQL_RESULT_LIMIT'), 'x')).toBe('Must be a whole number');
  });

  it('checks enums, booleans and endpoint names', () => {
    expect(validateLeafValue(e('/TABLE_SELECTION_MODE'), 'rag')).toBeNull();
    expect(validateLeafValue(e('/TABLE_SELECTION_MODE'), 'other')).toBe('Must be one of the listed values');
    expect(validateLeafValue(e('/BRIEF_ENABLED'), 'true')).toBe('Must be true or false');
    expect(validateLeafValue(e('/LLM_OVERRIDES/{role}/endpoint'), '')).toBe('Must be an endpoint name');
  });

  it('refuses a value for a secret field', () => {
    expect(validateLeafValue(e('/LLM_OVERRIDES/endpoints/{endpoint}/api_key'), 'sk-1')).toContain(
      'Keys are never entered here',
    );
  });

  it('checks pattern, length, lists and json accepts', () => {
    const c = withSynthetic();
    const g = (p: string) => c.union.fields[p]!;
    expect(validateLeafValue(g('/LABEL'), 'abc')).toBeNull();
    expect(validateLeafValue(g('/LABEL'), 'ABC')).toBe('Does not match the expected format');
    expect(validateLeafValue(g('/LABEL'), 'abcdefghi')).toBe('Use at most 8 characters');
    expect(validateLeafValue(g('/STOP_WORDS'), ['a'])).toBeNull();
    expect(validateLeafValue(g('/STOP_WORDS'), 'a')).toBe('Must be a list');
    expect(validateLeafValue(g('/STOP_WORDS'), [1])).toBe('Every item must be string');
    expect(validateLeafValue(g('/FLEX'), 3)).toBeNull();
    expect(validateLeafValue(g('/FLEX'), 'x')).toBeNull();
    expect(validateLeafValue(g('/FLEX'), true)).toBe('Must be integer or string');
    expect(validateLeafValue(g('/EXTRA/{key}'), { anything: [1] })).toBeNull();
  });

  it('accepts unset and validates each swept value', () => {
    const schema = leafSchema(e('/MILVUS_SEARCH_THRESHOLD'));
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(validateLeafValue(e('/MILVUS_SEARCH_THRESHOLD'), { sweep: [0.1, 0.2] })).toBeNull();
    expect(validateLeafValue(e('/MILVUS_SEARCH_THRESHOLD'), { sweep: [0.1, 0.1] })).toBe('Duplicate value');
    expect(validateLeafValue(e('/MILVUS_SEARCH_THRESHOLD'), { sweep: [] })).toBe(
      'A sweep needs a non-empty list of values',
    );
  });

  it('validates raw control text for RHF', () => {
    const schema = rawInputSchema(e('/MILVUS_SEARCH_THRESHOLD'));
    expect(schema.safeParse('').success).toBe(true);
    expect(schema.safeParse('0.4').success).toBe(true);
    expect(schema.safeParse('abc').success).toBe(false);
    const bad = schema.safeParse('3');
    expect(bad.success ? '' : bad.error.issues[0]?.message).toBe('Must be at most 1');
  });
});

describe('hints', () => {
  it('lists bounds and json accepts', () => {
    expect(hintText(e('/MILVUS_SEARCH_THRESHOLD'))).toBe('Range ≥ 0, ≤ 1.');
    const c = withSynthetic();
    expect(hintText(c.union.fields['/FLEX']!)).toBe(
      'JSON value: integer or string. Plain text is sent as a string.',
    );
    expect(hintText(c.union.fields['/STOP_WORDS']!)).toContain('A JSON list of string values.');
  });
});

describe('unmatchedPointers', () => {
  it('lists pointers no field describes, sorted', () => {
    expect(
      unmatchedPointers(ctx.union, [
        '/BRIEF_ENABLED',
        '/ZED',
        '/LLM_OVERRIDES/endpoints/x/model',
        '/ALPHA/a',
        '/LLM_OVERRIDES',
      ]),
    ).toEqual(['/ALPHA/a', '/LLM_OVERRIDES', '/ZED']);
  });
});
