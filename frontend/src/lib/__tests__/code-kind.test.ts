/** codeKind: a plain string value is SQL, JSON text, or prose (feedback 17 Nov D4). */
import { describe, expect, it } from 'vitest';
import { codeKind } from '../code';

describe('codeKind', () => {
  it('finds SQL', () => {
    expect(codeKind('SELECT region, COUNT(*) AS n FROM stores GROUP BY region')).toBe('sql');
    expect(codeKind('  with t as (select 1) select * from t')).toBe('sql');
  });

  it('finds JSON objects and arrays written as text', () => {
    expect(codeKind('{"a": 1, "b": [true, null]}')).toBe('json');
    expect(codeKind(' [1, 2, 3] ')).toBe('json');
  });

  it('keeps prose as prose', () => {
    expect(codeKind('Select the best answer from the list below.')).toBeNull();
    expect(codeKind('Top customers by revenue for segment 1?')).toBeNull();
    expect(codeKind('Select one answer from a, b, or c.')).toBeNull();
    expect(codeKind('{not json}')).toBeNull();
    expect(codeKind('42')).toBeNull();
    expect(codeKind('')).toBeNull();
  });
});
