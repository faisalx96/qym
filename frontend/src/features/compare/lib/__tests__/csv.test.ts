import { describe, expect, it } from 'vitest';
import { buildCompareCsv, csvEscape, neutralizeFormula, discoverExportColumns, tryParseObject } from '../csv';
import { buildCompareModel } from '../model';
import { makePayload } from './fixtures';

describe('compare csv', () => {
  const payload = makePayload([
    { id: 'A', name: 'run-a', scores: { i1: { correct: 1, quality: 0.9 }, i2: { correct: 0, quality: 0.2 } }, metaByItem: { i1: { domain: 'x' } } },
    { id: 'B', name: 'run-b', scores: { i1: { correct: 0, quality: 0.4 }, i2: { correct: 1, quality: 0.8 } } },
  ]);
  const model = buildCompareModel(payload, ['A', 'B']);
  const items = model.itemIds.map((itemId) => ({ itemId, rows: model.runs.map((r) => r.byItem.get(itemId) ?? null) }));

  it('escapes and parses python dicts', () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(tryParseObject("{'a': True, 'b': None}")).toEqual({ a: true, b: null });
    expect(tryParseObject('[1]')).toBeNull();
  });

  it('neutralizes spreadsheet formulas but not numbers', () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeFormula('-cmd|calc')).toBe("'-cmd|calc");
    expect(neutralizeFormula('-0.25')).toBe('-0.25');
    expect(neutralizeFormula('1e-3')).toBe('1e-3');
    expect(neutralizeFormula('hello')).toBe('hello');
  });

  it('discovers groups and builds a BOM CSV with only the chosen columns', () => {
    const groups = discoverExportColumns(model, items);
    expect(groups.map((g) => g.group)).toEqual(['Shared fields', 'Item metadata', ...model.runs.map((r) => r.label)]);
    const picked = groups.flatMap((g) => g.columns).filter((c) => ['item_id', 'meta:domain', 'run:1:quality_score', 'run:0:status'].includes(c.key));
    const csv = buildCompareCsv(model, items, picked);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('﻿Aligned item ID,domain,run-a / Status,run-b / quality score'.replace('run-a', model.runs[0]!.label).replace('run-b', model.runs[1]!.label));
    expect(lines[1]).toBe('i1,x,completed,0.4');
    expect(lines[2]).toBe('i2,,completed,0.8');
  });
});
