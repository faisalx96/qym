import { describe, expect, it } from 'vitest';
import { formResponse } from './__fixtures__/fixtures';
import {
  appendSegment,
  buildOverrides,
  childPointer,
  containsSweep,
  escapeSegment,
  fieldNameToPointer,
  flattenOverrides,
  isSweepValue,
  joinPointer,
  matchPointer,
  matchTemplate,
  nearestPointer,
  pointerToFieldName,
  stableStringify,
  splitPointer,
} from './pointers';

const descriptor = formResponse.descriptor;
const fields = descriptor.fields;

describe('pointer escaping', () => {
  it('escapes ~ and / per RFC 6901 and round-trips', () => {
    expect(escapeSegment('a/b~c')).toBe('a~1b~0c');
    expect(splitPointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(joinPointer(['a/b', 'c'])).toBe('/a~1b/c');
    expect(appendSegment('/x', 'k/1')).toBe('/x/k~11');
    expect(splitPointer('')).toEqual([]);
  });

  it('computes a concrete child pointer from templates', () => {
    expect(
      childPointer('/LLM_OVERRIDES/endpoints/{endpoint}', '/LLM_OVERRIDES/endpoints/fast', '/LLM_OVERRIDES/endpoints/{endpoint}/model'),
    ).toBe('/LLM_OVERRIDES/endpoints/fast/model');
  });
});

describe('matchPointer / matchTemplate', () => {
  it('maps a concrete pointer onto its template, literal before role row before key', () => {
    expect(matchPointer(descriptor, '/LLM_OVERRIDES/endpoints/fast/model')).toBe('/LLM_OVERRIDES/endpoints/{endpoint}/model');
    expect(matchPointer(descriptor, '/LLM_OVERRIDES/main/temperature')).toBe('/LLM_OVERRIDES/{role}/temperature');
    expect(matchPointer(descriptor, '/LLM_OVERRIDES/main/response_format/type')).toBe('/LLM_OVERRIDES/{role}/response_format/type');
    expect(matchPointer(descriptor, '/NOPE')).toBeNull();
    expect(matchPointer(descriptor, '/LLM_OVERRIDES/main/not_a_column')).toBeNull();
  });

  it('matches by shape with the fewest wildcards', () => {
    expect(matchTemplate(fields, '/LLM_OVERRIDES/endpoints/primary/model')).toBe('/LLM_OVERRIDES/endpoints/{endpoint}/model');
    expect(matchTemplate(fields, '/BRIEF_ENABLED')).toBe('/BRIEF_ENABLED');
    expect(matchTemplate(fields, '/UNKNOWN/x')).toBeNull();
  });
});

describe('flattenOverrides / buildOverrides', () => {
  const nested = {
    LLM_OVERRIDES: {
      endpoints: { primary: { model: 'gpt-4o', timeout: 30 } },
      main: { temperature: 0.2, response_format: { type: 'json_object' } },
    },
    BRIEF_ENABLED: true,
    MILVUS_SEARCH_THRESHOLD: { sweep: [0.1, 0.2] },
  };

  it('flattens descending objects until a descriptor field', () => {
    const flat = flattenOverrides(nested, fields);
    expect(flat).toEqual({
      '/LLM_OVERRIDES/endpoints/primary/model': 'gpt-4o',
      '/LLM_OVERRIDES/endpoints/primary/timeout': 30,
      '/LLM_OVERRIDES/main/temperature': 0.2,
      '/LLM_OVERRIDES/main/response_format/type': 'json_object',
      '/BRIEF_ENABLED': true,
      '/MILVUS_SEARCH_THRESHOLD': { sweep: [0.1, 0.2] },
    });
  });

  it('round-trips through buildOverrides', () => {
    expect(buildOverrides(flattenOverrides(nested, fields))).toEqual(nested);
  });

  it('keeps an object value at a json field whole and skips nulls', () => {
    const flat = flattenOverrides({ BRIEF_ENABLED: null, UNKNOWN: { a: 1 } }, fields);
    expect(flat).toEqual({ '/UNKNOWN/a': 1 });
  });

  it('escapes keys containing slashes', () => {
    expect(buildOverrides({ '/A/b~1c': 1 })).toEqual({ A: { 'b/c': 1 } });
  });
});

describe('sweep detection', () => {
  it('recognises only {sweep: [...]} objects', () => {
    expect(isSweepValue({ sweep: [1] })).toBe(true);
    expect(isSweepValue({ sweep: [1], other: 1 })).toBe(false);
    expect(isSweepValue({ sweep: 'x' })).toBe(false);
    expect(containsSweep({ a: [{ sweep: [1] }] })).toBe(true);
    expect(containsSweep({ a: 1 })).toBe(false);
  });

  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
});

describe('RHF-safe field names', () => {
  const samples = [
    '/env_overrides/LLM_OVERRIDES/endpoints/primary/model',
    '/env_overrides/a.b/c[0]/d~1e',
    '/slot_bindings/endpoint:primary',
    '#name',
    '/evaluator/config/run_metadata/ünï code',
    '',
    '/x/0/1',
  ];
  it.each(samples)('round-trips %j and contains no RHF path characters', (pointer) => {
    const name = pointerToFieldName(pointer);
    expect(name).not.toMatch(/[.[\]"'\s/]/);
    expect(name).not.toMatch(/^\d/);
    expect(fieldNameToPointer(name)).toBe(pointer);
  });

  it('is injective for look-alike pointers', () => {
    expect(pointerToFieldName('/a_2f_b')).not.toBe(pointerToFieldName('/a/b'));
    expect(fieldNameToPointer(pointerToFieldName('/a_2f_b'))).toBe('/a_2f_b');
  });
});

describe('nearestPointer', () => {
  it('prefers the exact match, else the longest ancestor', () => {
    const c = ['/env_overrides/A', '/env_overrides/A/b', '/env_overrides/B'];
    expect(nearestPointer('/env_overrides/A/b', c)).toBe('/env_overrides/A/b');
    expect(nearestPointer('/env_overrides/A/b/c', c)).toBe('/env_overrides/A/b');
    expect(nearestPointer('/env_overrides/C', c)).toBeNull();
    expect(nearestPointer('/env_overrides/AB', c)).toBeNull();
  });
});
