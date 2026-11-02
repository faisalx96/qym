import { describe, expect, it } from 'vitest';
import { makeCtx, makeEnv, PRODUCTION, twoEnvCtx, withSynthetic } from './__fixtures__/fixtures';
import { setBinding } from './bindings';
import { createDocument } from './document';
import { addKey, setValue } from './layering';
import {
  allLeaves,
  buildSettingsView,
  endpointRefOptions,
  groupOfPointer,
  UNMATCHED_GROUP,
  type CollectionNode,
  type LeafNode,
  type ObjectNode,
  type RoleTableNode,
} from './settingsTree';
import { pointerToFieldName } from './pointers';

const ctx = makeCtx();
const doc = createDocument({ environmentIds: [PRODUCTION] });

function find<T>(nodes: readonly { type: string }[], type: string): T {
  return nodes.find((n) => n.type === type) as T;
}

describe('settings view', () => {
  const view = buildSettingsView(doc, ctx);

  it('lists the descriptor groups in order, closed by default', () => {
    expect(view.groups.map((g) => g.id)).toEqual([
      'llm_routing',
      'feature_toggles',
      'rag',
      'sql_runner',
      'context',
      'visualization',
      'misc',
    ]);
    expect(view.groups.every((g) => !g.open)).toBe(true);
    expect(view.unmatched).toBeNull();
    expect(view.filtering).toBe(false);
    expect(view.empty).toBe(false);
  });

  it('builds the LLM routing tree: endpoints collection and a role table', () => {
    const llm = view.groups[0]!.nodes[0] as ObjectNode;
    expect(llm.type).toBe('object');
    const endpoints = find<CollectionNode>(llm.children, 'collection');
    expect(endpoints.keyParam).toBe('endpoint');
    expect(endpoints.items.map((i) => [i.key, i.required, i.removable])).toEqual([['primary', true, false]]);
    const roles = find<RoleTableNode>(llm.children, 'role_table');
    expect(roles.rowParam).toBe('role');
    expect(roles.rows.map((r) => r.key)).toContain('main');
    expect(roles.columns.map((c) => c.label)).toContain('temperature');
    expect(roles.columns.map((c) => c.label)).toContain('response_format.type');
    const main = roles.rows.find((r) => r.key === 'main')!;
    expect(main.cells).toHaveLength(roles.columns.length);
    expect(main.cells[0]!.pointer).toBe('/LLM_OVERRIDES/main/endpoint');
    expect(main.cells[0]!.label).toBe('main · Endpoint');
    expect(main.cells[0]!.fieldName).toBe(pointerToFieldName('/env_overrides/LLM_OVERRIDES/main/endpoint'));
  });

  it('gives each leaf its kind, label, hint and placeholder', () => {
    const leaves = allLeaves(view);
    const threshold = leaves.find((l) => l.pointer === '/MILVUS_SEARCH_THRESHOLD')!;
    expect(threshold).toMatchObject({
      kind: 'number',
      changed: false,
      boundBy: null,
      hint: 'Range ≥ 0, ≤ 1.',
      placeholder: 'Inherited from environment',
      docPointer: '/env_overrides/MILVUS_SEARCH_THRESHOLD',
    });
    expect(leaves.find((l) => l.pointer === '/TABLE_SELECTION_MODE')?.kind).toBe('enum');
    expect(leaves.find((l) => l.pointer === '/LLM_OVERRIDES/endpoints/primary/api_key')?.kind).toBe('secret');
    expect(leaves.find((l) => l.pointer === '/LLM_OVERRIDES/endpoints/primary/model')?.label).toBe(
      'primary · Model',
    );
  });

  it('collection "All endpoints" appears from one key (like "All roles")', () => {
    const withTwo = addKey(doc, '/LLM_OVERRIDES/endpoints', 'fast');
    const llm = buildSettingsView(withTwo, ctx).groups[0]!.nodes[0] as ObjectNode;
    const endpoints = find<CollectionNode>(llm.children, 'collection');
    expect(endpoints.items.map((i) => [i.key, i.removable])).toEqual([
      ['primary', false],
      ['fast', true],
    ]);
    expect(endpoints.allItems.map((a) => a.label)).toContain('All endpoints · Timeout');
    expect(endpoints.allItems.every((a) => a.pointers.length === 2)).toBe(true);
    // never for the secret
    expect(endpoints.allItems.some((a) => a.template.endsWith('api_key'))).toBe(false);
  });

  it('role-table "All roles" row targets only the rows shown', () => {
    const d = setValue(doc, '/LLM_OVERRIDES/main/temperature', 0.2);
    const roles = find<RoleTableNode>(
      (buildSettingsView(d, ctx).groups[0]!.nodes[0] as ObjectNode).children,
      'role_table',
    );
    const col = roles.columns.findIndex((c) => c.label === 'temperature');
    const all = roles.allRow[col]!;
    expect(all.label).toBe('All roles · temperature');
    expect(all.same).toBe(false);
    expect(all.pointers).toHaveLength(roles.rows.length);
    const filtered = find<RoleTableNode>(
      (buildSettingsView(d, ctx, { search: 'router' }).groups[0]!.nodes[0] as ObjectNode).children,
      'role_table',
    );
    expect(filtered.allRow[col]!.pointers).toEqual(['/LLM_OVERRIDES/router/temperature']);
  });
});

describe('locks and tags', () => {
  it('locks the fields a bound slot fills and says which slot', () => {
    const d = setBinding(doc, ctx, 'endpoint:primary', { kind: 'connection', id: 'conn-prod' });
    const leaf = allLeaves(buildSettingsView(d, ctx)).find(
      (l) => l.pointer === '/LLM_OVERRIDES/endpoints/primary/model',
    )!;
    expect(leaf.boundBy).toBe('Primary model');
    expect(leaf.placeholder).toBe('Set by Primary model');
    const timeout = allLeaves(buildSettingsView(d, ctx)).find(
      (l) => l.pointer === '/LLM_OVERRIDES/endpoints/primary/timeout',
    )!;
    expect(timeout.boundBy).toBeNull();
  });

  it('tags a setting missing from one environment and a local error for an edit on it', () => {
    const two = twoEnvCtx();
    const d = setValue(
      createDocument({ environmentIds: ['env-production', 'env-staging'] }),
      '/VIZ_MAX_GROUPS',
      4,
    );
    const leaf = allLeaves(buildSettingsView(d, two)).find((l) => l.pointer === '/VIZ_MAX_GROUPS')!;
    expect(leaf.missingEnvs).toEqual(['env-staging']);
    expect(leaf.notInEnvErrors).toEqual([
      'VIZ_MAX_GROUPS is not in environment "staging": reset it or deselect staging.',
    ]);
    const only = allLeaves(buildSettingsView(d, two)).find((l) => l.pointer === '/STAGING_ONLY_FLAG')!;
    expect(only.missingEnvs).toEqual(['env-production']);
    expect(only.notInEnvErrors).toEqual([]);
  });

  it('marks changed leaves against the baseline', () => {
    const d = {
      ...setValue(doc, '/BRIEF_ENABLED', true),
      baseline: { values: {}, bindings: {}, dataset: null },
    };
    const view = buildSettingsView(d, ctx);
    expect(view.changedCount).toBe(1);
    expect(allLeaves(view).find((l) => l.pointer === '/BRIEF_ENABLED')?.changed).toBe(true);
  });
});

describe('search and changed-only filtering', () => {
  it('shows only matching leaves and opens the groups that have a match', () => {
    const view = buildSettingsView(doc, ctx, { search: 'threshold' });
    expect(view.filtering).toBe(true);
    const visible = allLeaves(view)
      .filter((l) => l.visible)
      .map((l) => l.pointer);
    expect(visible).toEqual(
      expect.arrayContaining(['/MILVUS_SEARCH_THRESHOLD', '/CONTEXT_COMPACT_THRESHOLD']),
    );
    expect(visible).not.toContain('/BRIEF_ENABLED');
    const open = view.groups.filter((g) => g.open).map((g) => g.id);
    expect(open).toEqual(['rag', 'context']);
    expect(view.groups.find((g) => g.id === 'rag')).toMatchObject({
      visible: true,
      autoOpened: true,
      matches: 1,
    });
    expect(view.groups.find((g) => g.id === 'feature_toggles')).toMatchObject({
      visible: false,
      open: false,
    });
    expect(view.empty).toBe(false);
  });

  it('matches by name, label or pointer, case-insensitively', () => {
    const view = buildSettingsView(doc, ctx, { search: 'SQL_RESULT' });
    expect(
      allLeaves(view)
        .filter((l) => l.visible)
        .map((l) => l.pointer),
    ).toEqual(['/SQL_RESULT_LIMIT']);
  });

  it('matches the Raw JSON spelling of the pointer too (/env_overrides/...)', () => {
    const view = buildSettingsView(doc, ctx, { search: '/env_overrides/SQL_RESULT_LIMIT' });
    expect(
      allLeaves(view)
        .filter((l) => l.visible)
        .map((l) => l.pointer),
    ).toEqual(['/SQL_RESULT_LIMIT']);
  });

  it('says when nothing matches', () => {
    const view = buildSettingsView(doc, ctx, { search: 'zzzz-nothing' });
    expect(view.empty).toBe(true);
    expect(view.groups.every((g) => !g.visible)).toBe(true);
  });

  it('"changed only" shows edits and opens their groups; a remembered open group stays open', () => {
    const d = {
      ...setValue(doc, '/SQL_RESULT_LIMIT', 5),
      baseline: { values: {}, bindings: {}, dataset: null },
    };
    const view = buildSettingsView(d, ctx, { changedOnly: true, groupOpen: { misc: true } });
    expect(
      allLeaves(view)
        .filter((l) => l.visible)
        .map((l) => l.pointer),
    ).toEqual(['/SQL_RESULT_LIMIT']);
    expect(view.groups.filter((g) => g.open).map((g) => g.id)).toEqual(['sql_runner', 'misc']);
    expect(view.groups.find((g) => g.id === 'misc')).toMatchObject({
      open: true,
      autoOpened: false,
      visible: false,
    });
  });

  it('role rows filter by row text and by changed cells', () => {
    const d = {
      ...setValue(doc, '/LLM_OVERRIDES/router/temperature', 0.7),
      baseline: { values: {}, bindings: {}, dataset: null },
    };
    const llm = (v: ReturnType<typeof buildSettingsView>) =>
      find<RoleTableNode>((v.groups[0]!.nodes[0] as ObjectNode).children, 'role_table');
    expect(
      llm(buildSettingsView(d, ctx, { changedOnly: true }))
        .rows.filter((r) => r.visible)
        .map((r) => r.key),
    ).toEqual(['router']);
    expect(
      llm(buildSettingsView(d, ctx, { search: 'main' }))
        .rows.filter((r) => r.visible)
        .map((r) => r.key),
    ).toEqual(['main']);
  });

  it('user-opened groups are open without a filter', () => {
    const view = buildSettingsView(doc, ctx, { groupOpen: { rag: true } });
    expect(view.groups.filter((g) => g.open).map((g) => g.id)).toEqual(['rag']);
  });
});

describe('Other values', () => {
  it('lists pointers no schema describes, open by default, editable as JSON', () => {
    const d = createDocument({
      environmentIds: [PRODUCTION],
      values: { '/MYSTERY/a': 1, '/BRIEF_ENABLED': true, '/LLM_OVERRIDES': { x: 1 } },
    });
    const view = buildSettingsView(d, ctx);
    expect(view.unmatched).toMatchObject({
      id: UNMATCHED_GROUP,
      label: 'Other values',
      count: 2,
      open: true,
    });
    const leaves = view.unmatched!.nodes as LeafNode[];
    expect(leaves.map((l) => l.pointer)).toEqual(['/LLM_OVERRIDES', '/MYSTERY/a']);
    expect(leaves.every((l) => l.removable && l.edit.type === 'json')).toBe(true);
    expect(buildSettingsView(d, ctx, { groupOpen: { unmatched: false } }).unmatched?.open).toBe(false);
  });

  it('shows no settings before an environment form is loaded', () => {
    const loading = makeCtx({ envs: [makeEnv(PRODUCTION, 'p', { formError: 'down' })] });
    const view = buildSettingsView(createDocument({ values: { '/A': 1 } }), loading);
    expect(view.groups).toEqual([]);
    expect(view.unmatched).toBeNull();
  });
});

describe('open objects, JSON fallback and endpoint refs', () => {
  const c = withSynthetic();
  const d = createDocument({
    environmentIds: [PRODUCTION],
    values: { '/EXTRA/known': 1, '/EXTRA/custom': { a: 1 }, '/SQL_RESULT_LIMIT': { bad: true } },
  });

  it('lists the extra keys of an open object and offers adding more', () => {
    const view = buildSettingsView(addKey(d, '/EXTRA#extra', 'later'), c);
    const extra = view.groups
      .find((g) => g.id === 'misc')!
      .nodes.find((n) => n.pointer === '/EXTRA') as ObjectNode;
    expect(extra.extra?.fixedKeys).toEqual(['known']);
    expect(extra.extra?.items.map((i) => i.key)).toEqual(['custom', 'later']);
    const item = extra.extra!.items[0]!.node as LeafNode;
    expect(item).toMatchObject({ removable: true, title: 'custom', pointer: '/EXTRA/custom' });
    expect(item.entry.type).toBe('json');
  });

  it('edits a value that does not fit its widget as JSON', () => {
    const leaf = allLeaves(buildSettingsView(d, c)).find((l) => l.pointer === '/SQL_RESULT_LIMIT')!;
    expect(leaf.kind).toBe('json');
    expect(leaf.edit.fallback).toBe('integer');
    expect(leaf.entry.type).toBe('integer');
  });

  it('endpoint-ref options are the collection keys including slots and added keys', () => {
    const entry = ctx.union.fields['/LLM_OVERRIDES/{role}/endpoint']!;
    expect(endpointRefOptions(doc, ctx, entry)).toEqual(['primary']);
    expect(endpointRefOptions(addKey(doc, '/LLM_OVERRIDES/endpoints', 'fast'), ctx, entry)).toEqual([
      'primary',
      'fast',
    ]);
  });
});

describe('groupOfPointer', () => {
  it('finds the group of a pointer through templates, else Other values', () => {
    expect(groupOfPointer(ctx, '/LLM_OVERRIDES/endpoints/fast/model')).toBe('llm_routing');
    expect(groupOfPointer(ctx, '/SQL_RESULT_LIMIT')).toBe('sql_runner');
    expect(groupOfPointer(ctx, '/NOT/THERE')).toBe(UNMATCHED_GROUP);
    expect(groupOfPointer(ctx, '')).toBeNull();
  });
});
