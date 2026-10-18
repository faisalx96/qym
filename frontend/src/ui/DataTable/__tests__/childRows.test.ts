import { describe, expect, it } from 'vitest';
import { buildDisplayRows, rangeKeys } from '../model';

interface R {
  id: string;
  kids?: R[];
}
const run = (id: string, n = 0): R => ({
  id,
  kids: Array.from({ length: n }, (_, i) => ({ id: `${id}::pass${i + 1}` })),
});
const key = (r: R) => r.id;
const base = { collapsed: new Set<string>(), canExpand: true };

describe('buildDisplayRows child rows', () => {
  const rows = [run('a', 3), run('b'), run('c', 2)];
  const children = (r: R) => (r.kids?.length ? { rows: r.kids } : undefined);

  it('emits nothing extra while collapsed', () => {
    const out = buildDisplayRows(rows, key, { ...base, expanded: new Set(), children });
    expect(out.map((d) => d.kind)).toEqual(['row', 'row', 'row']);
  });

  it('puts children after their parent and the detail row after the last child', () => {
    const out = buildDisplayRows(rows, key, { ...base, expanded: new Set(['a']), children });
    expect(out.map((d) => d.id)).toEqual([
      'r:a',
      'c:a::pass1',
      'c:a::pass2',
      'c:a::pass3',
      'd:a',
      'r:b',
      'r:c',
    ]);
  });

  it('numbers the children for aria-posinset / setsize and keeps the parent link', () => {
    const out = buildDisplayRows(rows, key, { ...base, expanded: new Set(['c']), children });
    const kids = out.filter((d) => d.kind === 'child');
    expect(kids.map((d) => (d.kind === 'child' ? [d.posinset, d.setsize, d.parentKey] : []))).toEqual([
      [1, 2, 'c'],
      [2, 2, 'c'],
    ]);
  });

  it('skips the detail row when the children say so', () => {
    const out = buildDisplayRows(rows, key, {
      ...base,
      expanded: new Set(['a']),
      children: (r) => (r.kids?.length ? { rows: r.kids, detail: false } : undefined),
    });
    expect(out.some((d) => d.kind === 'detail')).toBe(false);
  });

  it('keeps the old behaviour (detail only) for a row without children', () => {
    const out = buildDisplayRows(rows, key, { ...base, expanded: new Set(['b']), children });
    expect(out.map((d) => d.id)).toEqual(['r:a', 'r:b', 'd:b', 'r:c']);
  });

  it('keeps children under their parent when the input order changes', () => {
    const out = buildDisplayRows([rows[2]!, rows[0]!], key, {
      ...base,
      expanded: new Set(['a', 'c']),
      children,
    });
    expect(out.map((d) => d.id)).toEqual([
      'r:c',
      'c:c::pass1',
      'c:c::pass2',
      'd:c',
      'r:a',
      'c:a::pass1',
      'c:a::pass2',
      'c:a::pass3',
      'd:a',
    ]);
  });

  it('ranges over run and child rows in display order', () => {
    const order = buildDisplayRows(rows, key, { ...base, expanded: new Set(['a']), children })
      .filter((d) => d.kind === 'row' || d.kind === 'child')
      .map((d) => (d as { key: string }).key);
    expect(rangeKeys(order, 'a::pass1', 'a::pass3')).toEqual(['a::pass1', 'a::pass2', 'a::pass3']);
  });
});
