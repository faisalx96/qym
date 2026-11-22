import { describe, expect, it } from 'vitest';
import { jsonLines } from './JsonCode';

const text = (v: unknown) =>
  jsonLines(v)
    .map((l) => '  '.repeat(l.depth) + l.tokens.map((t) => t.text).join(''))
    .join('\n');

describe('jsonLines', () => {
  it('writes the lines that JSON.stringify writes, two spaces a level', () => {
    const v = { a: 1, b: [true, null, 'x'], c: {}, d: { e: 'f' } };
    expect(text(v)).toBe(JSON.stringify(v, null, 2));
  });

  it('marks each group with its closing line, its name and its count', () => {
    const lines = jsonLines({ a: [1, 2], b: { c: 1 } });
    const root = lines[0]!.group!;
    expect(root).toMatchObject({ name: 'root', end: lines.length - 1, summary: '2 keys' });
    expect(lines[1]!.group).toMatchObject({ name: 'a', summary: '2 items' });
    expect(lines.map((l) => l.n)).toEqual(lines.map((_, i) => i + 1));
  });

  it('keeps a list of records and a SQL string as plain JSON lines', () => {
    const v = { query: 'select id from t where a = 1', lines: [{ sku: 'A', qty: 1 }] };
    expect(text(v)).toBe(JSON.stringify(v, null, 2));
    const lines = jsonLines(v);
    expect(lines[1]!.tokens.map((t) => t.text).join('')).toBe('"query": "select id from t where a = 1",');
    expect(lines[2]!.group).toMatchObject({ name: 'lines', summary: '1 item' });
  });
});
