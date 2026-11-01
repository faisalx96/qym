/** C084: a finished run's index drops zero and false attempt trace stats; the pass view puts them back. */
import { describe, expect, it } from 'vitest';
import { fullTraceStats } from '../passScope';

describe('fullTraceStats', () => {
  it('fills the keys the server left out with the empty form of the row-level value', () => {
    const lean = { span_count: 27, tokens: 21067 };
    const template = {
      span_count: 300,
      tokens: 1,
      cost: 0.5,
      has_reasoning: true,
      outer: { a: 1 },
      list: [1],
    };
    expect(fullTraceStats(lean, template)).toEqual({
      span_count: 27,
      tokens: 21067,
      cost: 0,
      has_reasoning: false,
      outer: {},
      list: [],
    });
  });

  it('keeps the stats as they are without a template', () => {
    const lean = { tokens: 5 };
    expect(fullTraceStats(lean, null)).toBe(lean);
  });
});
