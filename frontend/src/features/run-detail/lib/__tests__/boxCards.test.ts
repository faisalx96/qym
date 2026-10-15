/** Round 3 P7: the card's values equal what its header mean averages (P7-3), the Total rule (P7-5), entries and filters. */
import { describe, expect, it } from 'vitest';
import { traceEntries, MIN_TRACE_ITEMS } from '../boxEntries';
import { boxFormatter, formatCost, showsTotal } from '../boxFormat';
import { rangeOf, selectedPart, withRangeRule } from '../boxFilters';
import { boxStats } from '../boxStats';
import { emptyGroup } from '../filterRules';
import type { Row } from '../../types';

const row = (id: string, trace?: Record<string, number>) =>
  ({ item_id: id, trace_stats: trace }) as unknown as Row;

describe('Total visibility (P7-5)', () => {
  it('shows for numeric metrics, tokens and cost; never for latency or scores; never with a negative value', () => {
    expect(showsTotal('numeric', false)).toBe(true);
    expect(showsTotal('tokens', false)).toBe(true);
    expect(showsTotal('cost', false)).toBe(true);
    expect(showsTotal('latency', false)).toBe(false);
    expect(showsTotal('percent', false)).toBe(false);
    expect(showsTotal('numeric', true)).toBe(false);
  });
});

describe('header mean and plot agree (P7-3)', () => {
  it('the mean of the card values is the mean the plot shows', () => {
    const values = [10, 20, 30, 0, 0, 40];
    expect(boxStats(values).mean).toBeCloseTo(values.reduce((a, b) => a + b, 0) / values.length);
  });
});

describe('trace entries', () => {
  it('keeps items that carry a number and the card needs at least two', () => {
    const rows = [row('a', { tokens: 10 }), row('b'), row('c', { tokens: 30 })];
    const e = traceEntries(rows, 'tokens');
    expect(e.map((x) => x.id)).toEqual(['a', 'c']);
    expect(e.length >= MIN_TRACE_ITEMS).toBe(true);
    expect(traceEntries([row('a', { cost: 0.1 })], 'cost').length >= MIN_TRACE_ITEMS).toBe(false);
  });
});

describe('formatters', () => {
  it('cost keeps enough decimals for fractions of a cent', () => {
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost(0.5)).toBe('$0.500');
    expect(formatCost(12.5)).toBe('$12.50');
    expect(boxFormatter('latency')(1800)).toBe('1.8 s');
  });
});

describe('range filters', () => {
  it('adds gte / lte, replaces an earlier range on the same field and keeps other rules', () => {
    const base = {
      op: 'and' as const,
      children: [
        { field: 'metric:x', oper: 'gte', value: '1' },
        { field: 'other', oper: 'eq', value: '2' },
      ],
    };
    const next = withRangeRule(base, 'metric:x', 5, 9);
    expect(next.children).toHaveLength(3);
    expect(rangeOf(next, 'metric:x')).toEqual({ min: 5, max: 9 });
    expect(withRangeRule(emptyGroup(), 'tokens', 1, 2).children).toHaveLength(2);
  });

  it('marks the part whose range is active', () => {
    const s = { min: 0, p25: 25, p75: 75, max: 100 };
    expect(selectedPart({ min: 25, max: 75 }, s)).toBe('box');
    expect(selectedPart({ min: 0, max: 25 }, s)).toBe('low');
    expect(selectedPart({ min: 75, max: 100 }, s)).toBe('high');
    expect(selectedPart({ min: 1, max: 2 }, s)).toBeNull();
    expect(selectedPart(null, s)).toBeNull();
  });
});
