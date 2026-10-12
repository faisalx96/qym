/**
 * Cutover of tests/platform/test_compare_baseline_browser.py: the change against the baseline and
 * its verdict come from the items both runs scored, a run average is the run mean when items have
 * unequal passes, and object-valued categories read as JSON. (Column labels, the baseline link and
 * the pass columns are covered by model.test.ts / stats.test.ts and e2e/compare/selection.spec.ts.)
 */
import { describe, expect, it } from 'vitest';
import type { Row } from '@/features/run-detail/types';
import { columnItemScores, compareWithBaseline, metricColumns } from '../baseline';
import { categoryGroups } from '../breakdown';
import { buildCompareModel } from '../model';
import { metricCtx } from '../scoring';
import { makePayload } from './fixtures';

const items = (n: number, f: (i: number) => number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`i${i}`, { correct: f(i) >= 0.7 ? 1 : 0, quality: f(i) }]),
  );

describe('the change and its verdict come from the items both runs scored', () => {
  it('run-2 stopped half way: every paired item improved even though its average is lower', () => {
    // run-1 scored 0 on items 0..19 and 1 on items 20..39; run-2 only ran items 0..19 (0.2 / 0.3).
    const payload = makePayload([
      { id: 'run-1', model: 'a', scores: items(40, (i) => (i < 20 ? 0 : 1)) },
      { id: 'run-2', model: 'b', scores: items(20, (i) => (i % 2 ? 0.2 : 0.3)) },
    ]);
    const model = buildCompareModel(payload, ['run-1', 'run-2']);
    const ctx = metricCtx(model, 'quality');
    const [base, cand] = metricColumns(model, 'run');
    const baseScores = columnItemScores(model, base!, ctx);
    const candScores = columnItemScores(model, cand!, ctx);
    const result = compareWithBaseline(candScores, baseScores, ctx);
    expect(result.paired).toBe(20);
    expect(result.counts).toEqual({ improved: 20, regressed: 0, same: 0 });
    expect(result.mean).toBeCloseTo(0.25, 9);
    expect(result.verdict).toBe('improved');
    // The averages over different items point the other way (which is why the tooltip explains it).
    const avg = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0) / m.size;
    expect(avg(candScores) - avg(baseScores)).toBeCloseTo(-0.25, 9);
  });
});

describe('run average (Avg@k) is the run mean when items have unequal passes', () => {
  it('each item is the mean over its scored passes, then the mean over items', () => {
    // Even items have two scored passes of 1 and an unscored third; odd items three 0s.
    // The run mean is 50%; pooling every pass score would give 40%.
    const payload = makePayload(
      ['run-1', 'run-2'].map((id) => ({
        id,
        model: id,
        samples: 3,
        scores: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [
            `i${i}`,
            { correct: i % 2 ? [0, 0, 0] : [1, 1, 1], quality: i % 2 ? [0, 0, 0] : [1, 1, 1] },
          ]),
        ),
      })),
    );
    payload.runs.forEach((run) =>
      run.snapshot.rows.forEach((row: Row, i: number) => {
        if (i % 2 === 0) {
          const scores = row.pass_scores!.quality as Array<number | null>;
          scores[2] = null;
        }
      }),
    );
    const model = buildCompareModel(payload, ['run-1', 'run-2']);
    const ctx = metricCtx(model, 'quality');
    for (const column of metricColumns(model, 'run')) {
      const scores = columnItemScores(model, column, ctx);
      const mean = [...scores.values()].reduce((a, b) => a + b, 0) / scores.size;
      expect(mean).toBeCloseTo(0.5, 9);
    }
  });
});

describe('object-valued categories read as JSON, never [object Object]', () => {
  it('names the group by the object serialised', () => {
    const rows = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`i${i}`, { correct: 1, quality: 0.9 }]),
    );
    const payload = makePayload([
      { id: 'run-1', model: 'a', scores: rows },
      { id: 'run-2', model: 'b', scores: rows },
    ]);
    payload.runs.forEach((run) =>
      run.snapshot.rows.forEach((row: Row, i: number) => {
        row.item_metadata = { complexity: { level: i % 2 ? 'hard' : 'easy' } };
      }),
    );
    const model = buildCompareModel(payload, ['run-1', 'run-2']);
    const groups = categoryGroups(
      model,
      'complexity',
      metricColumns(model, 'run'),
      model.itemIds,
      metricCtx(model, 'quality'),
    );
    const names = groups.map((g) => g.value);
    expect(names.join('|')).not.toContain('[object Object]');
    expect(names).toEqual(expect.arrayContaining(['{"level":"hard"}', '{"level":"easy"}']));
  });
});

describe('category metadata without scores has no performance report (test_report_section_visibility_browser.py)', () => {
  it('compare: no category group when no run scored the items', () => {
    const rows = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`i${i}`, { correct: 0, quality: 0 }]),
    );
    const payload = makePayload([
      { id: 'run-1', model: 'a', scores: rows },
      { id: 'run-2', model: 'b', scores: rows },
    ]);
    payload.runs.forEach((run) =>
      run.snapshot.rows.forEach((row: Row) => {
        row.metric_values = ['', ''];
        row.item_metadata = { domain: 'finance' };
      }),
    );
    const model = buildCompareModel(payload, ['run-1', 'run-2']);
    expect(
      categoryGroups(
        model,
        'domain',
        metricColumns(model, 'run'),
        model.itemIds,
        metricCtx(model, 'quality'),
      ),
    ).toEqual([]);
  });
});

describe('a reviewed run has no editor (test_review_rules_browser.py)', () => {
  it('SUBMITTED and APPROVED runs lock their scores; the others keep them editable', async () => {
    const { runScoresLocked } = await import('../rowCells');
    const lock = (status: string) => runScoresLocked({ run: { status } } as never);
    expect([
      lock('SUBMITTED'),
      lock('APPROVED'),
      lock('COMPLETED'),
      lock('REJECTED'),
      lock('approved'),
    ]).toEqual([true, true, false, false, true]);
  });
});
