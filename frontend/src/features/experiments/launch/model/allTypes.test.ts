/**
 * Every field type the backend schema generator can emit (all-types.json is the real output of
 * `build_form_descriptor` for a schema that uses each type, widget and quirk): each one must
 * classify, build a settings tree node, validate, and round-trip through its text control.
 */
import { describe, expect, it } from 'vitest';
import allTypes from './__fixtures__/all-types.json';
import { makeCtx, PRODUCTION } from './__fixtures__/fixtures';
import { buildSettingsView, allLeaves } from './settingsTree';
import { formatInput, leafKind, parseInput, validateLeafValue } from './descriptor';
import { createDocument } from './document';
import type { DescriptorEntry, FormDescriptor, FormResponse } from './types';
import { envDataFrom } from './descriptor';

const descriptor = allTypes as unknown as FormDescriptor;
const fields = Object.values(descriptor.fields);
const byPointer = (p: string) => descriptor.fields[p] as DescriptorEntry;

function ctxFor() {
  const form: FormResponse = { environment_id: PRODUCTION, schema_id: 's', schema_hash: 'h', descriptor };
  const env = envDataFrom({
    id: PRODUCTION,
    name: 'production',
    form,
    slots: { slots: [] },
    options: null,
    maxPriority: 'HIGH',
    defaultPriority: 'NORMAL',
    schemaHash: 'h',
  });
  return makeCtx({ envs: [env], panel: null });
}

describe('schema field types', () => {
  it('covers every type and widget the generator emits', () => {
    const types = new Set(fields.map((f) => f.type));
    for (const t of ['boolean', 'integer', 'number', 'string', 'enum', 'object', 'array', 'json'])
      expect(types, t).toContain(t);
    const widgets = new Set(fields.map((f) => f.widget));
    for (const w of [
      'select',
      'number',
      'number-range',
      'text',
      'url',
      'secret',
      'model-name',
      'endpoint-ref',
      'json',
      'group',
      'collection',
      'role-table',
      'toggle',
    ])
      expect(widgets, w).toContain(w);
  });

  it('classifies every leaf into a known control kind', () => {
    const kinds = new Set([
      'secret',
      'boolean',
      'enum',
      'endpoint-ref',
      'json',
      'array',
      'object',
      'number',
      'text',
    ]);
    for (const f of fields.filter((x) => x.kind === 'field'))
      expect(kinds.has(leafKind(f)), f.pointer).toBe(true);
  });

  it('puts every leaf of the schema into the settings tree', () => {
    const view = buildSettingsView(createDocument(), ctxFor());
    const leaves = new Set(allLeaves(view).map((l) => l.entry.pointer));
    const missing = fields
      .filter((f) => f.kind === 'field' && !f.pointer.includes('{') && leafKind(f) !== 'secret')
      .map((f) => f.pointer)
      .filter((p) => !leaves.has(p));
    expect(missing).toEqual([]);
    expect(view.groups.length).toBeGreaterThan(0);
  });

  it('validates scalars against type, bounds, pattern and enum', () => {
    expect(validateLeafValue(byPointer('/FLAG'), true)).toBeNull();
    expect(validateLeafValue(byPointer('/FLAG'), 'true')).not.toBeNull();
    expect(validateLeafValue(byPointer('/COUNT'), 5)).toBeNull();
    expect(validateLeafValue(byPointer('/COUNT'), 0)).not.toBeNull();
    expect(validateLeafValue(byPointer('/COUNT'), 10)).not.toBeNull();
    expect(validateLeafValue(byPointer('/COUNT'), 2.5)).not.toBeNull();
    expect(validateLeafValue(byPointer('/RATIO'), 0.5)).toBeNull();
    expect(validateLeafValue(byPointer('/RATIO'), -1)).not.toBeNull();
    expect(validateLeafValue(byPointer('/BOUNDED'), 1.5)).not.toBeNull();
    expect(validateLeafValue(byPointer('/TITLE'), 'abc')).toBeNull();
    expect(validateLeafValue(byPointer('/TITLE'), 'ABC')).not.toBeNull();
    expect(validateLeafValue(byPointer('/TITLE'), 'a')).not.toBeNull();
    expect(validateLeafValue(byPointer('/MODE'), 'a')).toBeNull();
    expect(validateLeafValue(byPointer('/MODE'), 'z')).not.toBeNull();
    expect(validateLeafValue(byPointer('/LEVEL'), 2)).toBeNull();
    expect(validateLeafValue(byPointer('/LEVEL'), '2')).not.toBeNull();
    expect(validateLeafValue(byPointer('/TAGS'), ['a', 'b'])).toBeNull();
    expect(validateLeafValue(byPointer('/TAGS'), [1])).not.toBeNull();
    expect(validateLeafValue(byPointer('/NUMS'), [1, 2])).toBeNull();
    expect(validateLeafValue(byPointer('/FREE'), { a: 1 })).toBeNull();
    expect(validateLeafValue(byPointer('/UNION'), 3)).toBeNull();
    expect(validateLeafValue(byPointer('/UNION'), 'x')).toBeNull();
    expect(validateLeafValue(byPointer('/UNION'), true)).not.toBeNull();
    expect(validateLeafValue(byPointer('/ANY'), { x: [1] })).toBeNull();
  });

  it('round-trips each value through its text control', () => {
    const samples: Record<string, unknown> = {
      '/FLAG': false,
      '/COUNT': 4,
      '/RATIO': 0.25,
      '/TITLE': 'abc',
      '/MODE': 'b',
      '/LEVEL': 3,
      '/TAGS': ['a', 'b'],
      '/NUMS': [1, 2],
      '/FREE': { a: 1 },
      '/UNION': 'text',
      '/ANY': { x: [1, 2] },
      '/BASE_URL': 'https://example.com/v1',
    };
    for (const [pointer, value] of Object.entries(samples)) {
      const e = byPointer(pointer);
      const parsed = parseInput(e, formatInput(e, value));
      expect(parsed, pointer).toEqual({ value });
    }
    expect(parseInput(byPointer('/COUNT'), '2.5')).toHaveProperty('error');
    expect(parseInput(byPointer('/COUNT'), '')).toEqual({ unset: true });
  });

  it('never accepts a value for a secret field', () => {
    const secrets = fields.filter((f) => f.secret);
    expect(secrets.map((s) => s.pointer).sort()).toEqual(['/API_KEY', '/PASSWORD_F']);
    for (const s of secrets) expect(validateLeafValue(s, 'sk-live')).not.toBeNull();
  });

  it('exposes the rag_iteration quirk hint and the collection and role-table rules', () => {
    expect(byPointer('/RAG_ITERATION').hints?.values).toEqual(['', 'latest']);
    expect(descriptor.rules?.map((r) => r.rule).sort()).toEqual([
      'endpoint_ref',
      'min_items',
      'required_keys',
    ]);
  });
});
