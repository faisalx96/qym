import { describe, expect, it } from 'vitest';
import { makeCtx, PRODUCTION } from './__fixtures__/fixtures';
import { createDocument } from './document';
import { addKey } from './layering';
import { collectionTableModel, columnKind, listTableModel, uniformKeys } from './listTable';
import { buildSettingsView, type CollectionNode, type ObjectNode } from './settingsTree';

describe('listTableModel (any list of the schema as a table)', () => {
  it('a list of scalars is one "Value" column with a global row', () => {
    expect(listTableModel(['a', 'b'])).toEqual({
      shape: 'scalars',
      rows: 2,
      columns: [{ key: null, label: 'Value', kind: 'string', scalar: true }],
    });
    expect(listTableModel([1, 2, 3])?.columns[0]?.kind).toBe('number');
    expect(listTableModel([true, false])?.columns[0]?.kind).toBe('boolean');
    expect(listTableModel([1, 'x'])?.columns[0]?.kind).toBe('auto');
  });

  it('objects with the same keys: a column per key; nested values are not writable globally', () => {
    const model = listTableModel([
      { name: 'a', limit: 1, nested: { x: 1 } },
      { name: 'b', limit: 2, nested: { x: 2 } },
    ]);
    expect(model?.shape).toBe('objects');
    expect(model?.columns.map((c) => [c.key, c.kind, c.scalar])).toEqual([
      ['name', 'string', true],
      ['limit', 'number', true],
      ['nested', 'auto', false],
    ]);
  });

  it('does not map empty lists, mixed key sets or lists of lists', () => {
    expect(listTableModel([])).toBeNull();
    expect(listTableModel([{ a: 1 }, { b: 2 }])).toBeNull();
    expect(listTableModel([[1], [2]])).toBeNull();
    expect(uniformKeys([{ a: 1 }, { a: 2 }])).toEqual(['a']);
    expect(columnKind([null, 'x'])).toBe('auto');
  });
});

describe('collectionTableModel (the endpoints as a table)', () => {
  const ctx = makeCtx();
  const llm = (doc = createDocument({ environmentIds: [PRODUCTION] })) =>
    (buildSettingsView(doc, ctx).groups[0]!.nodes[0] as ObjectNode).children.find(
      (n) => n.type === 'collection',
    ) as CollectionNode;

  it('maps flat items to columns, a row per key and a global row from two keys', () => {
    const one = collectionTableModel(llm());
    expect(one?.rows.map((r) => r.item.key)).toEqual(['primary']);
    expect(one?.columns.length).toBeGreaterThan(2);
    expect(one?.allRow.every((a) => a === null)).toBe(true);
    const two = collectionTableModel(
      llm(addKey(createDocument({ environmentIds: [PRODUCTION] }), '/LLM_OVERRIDES/endpoints', 'fast')),
    );
    expect(two?.rows.map((r) => r.item.key)).toEqual(['primary', 'fast']);
    expect(two?.allRow.some(Boolean)).toBe(true);
    expect(two?.rows.every((r) => r.cells.length === two.columns.length)).toBe(true);
  });
});
