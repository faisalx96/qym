import { describe, expect, it } from 'vitest';
import type { AnalysisJob } from '@/api/analysis';
import { outcomeText, summarize, viewRunTo } from '../../blocks/JobStatus';
import { tryParseJson } from '../mapping';

const job = (result: Record<string, unknown>, progress: Record<string, unknown> = {}) =>
  ({
    status: 'completed',
    pass_number: null,
    progress: { phase: 'completed', completed: 6, total: 6, errors: 0, retries: 0, ...progress },
    result,
  }) as unknown as AnalysisJob;

describe('job outcome', () => {
  it('total_analyzed counts failures too: all failed is a failure, not a success', () => {
    const sum = summarize(
      job({
        total_attempted: 6,
        total_analyzed: 6,
        total_analysis_failed: 6,
        results: Array.from({ length: 6 }, () => ({ error: 'boom' })),
      }),
    );
    expect(sum).toMatchObject({ attempted: 6, analyzed: 0, failed: 6, allFailed: true });
    expect(sum.groups).toEqual([['analysis_error', 6]]);
    expect(outcomeText(sum)).toBe('0 of 6 metric analyses succeeded, 6 failed');
  });

  it('partial failures are not allFailed; categories and retries are read from the result', () => {
    const sum = summarize(
      job({
        total_attempted: 3,
        total_analyzed: 3,
        total_analysis_failed: 1,
        categories: { A: 1, B: 2 },
        retries: 2,
        results: [{ error: 'x', error_code: 'llm_timeout' }],
      }),
    );
    expect(sum).toMatchObject({ analyzed: 2, failed: 1, allFailed: false, categories: 2, retries: 2 });
  });

  it('a clean job has no failures', () => {
    expect(summarize(job({ total_attempted: 2, total_analyzed: 2 }))).toMatchObject({
      analyzed: 2,
      failed: 0,
      allFailed: false,
    });
  });

  it('View run keeps the analysed sample', () => {
    expect(viewRunTo('p', 'r1', 2)).toBe('/projects/p/runs/r1?pass=2');
    expect(viewRunTo('p', 'r1', null)).toBe('/projects/p/runs/r1');
  });
});

describe('python literal values', () => {
  it('parses a stringified dict', () => {
    expect(tryParseJson("{'question': 'x', 'tables': ['a'], 'ok': True, 'n': None}")).toEqual({
      question: 'x',
      tables: ['a'],
      ok: true,
      n: null,
    });
  });
  it('rejects arbitrary words', () => {
    expect(tryParseJson('{foo: 1}')).toBeNull();
    expect(tryParseJson('plain text')).toBeNull();
  });
});
