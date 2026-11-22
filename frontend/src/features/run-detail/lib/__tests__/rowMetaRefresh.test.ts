/**
 * I14 (November 2026): on a running run, the opened metadata of a metric (two tables and the judge's text) disappeared
 * at the next live refresh. The index row keeps only short scalars of the metric metadata (run_payloads.py
 * `_compact_metric_meta`), and the refetch replaced the full metadata of a loaded row with that compact form while
 * the row still counted as loaded. A loaded row now keeps its full metadata while the compact values agree with it.
 */
import { describe, expect, it } from 'vitest';
import { inheritLoadedBodies, inheritMetricMeta, reuseRows, sameJson } from '../rowSignature';
import type { Row, RunPayload } from '../../types';

const TABLE = [
  { المنطقة: 'الرياض', الربع: 'Q1', المبيعات: 1000 },
  { المنطقة: 'جدة', الربع: 'Q2', المبيعات: 1113 },
];
const LONG = 'The generated SQL selects the same rows as the reference query. '.repeat(5);

/** The full metadata of `accuracy` for one pass, as /items/details returns it. */
const fullAccuracy = (pass: number) => ({
  exact_match_cell_f1: 100,
  exact_match_result_score: true,
  llm_judge_reasoning: `${LONG} (pass ${pass})`,
  explanation: `Pass ${pass} matches the reference.`,
  expected_rows: TABLE,
  actual_rows: TABLE,
});

/** The same metadata as the index keeps it: short scalars only. */
const compactAccuracy = () => ({ exact_match_cell_f1: 100, exact_match_result_score: true });

const attempt = (pass: number) => ({
  pass_number: pass,
  status: 'completed',
  output_digest: `d${pass}`,
  __has_output: true,
  __execution_error: '',
});

function compactRow(passes = 2, over: Partial<Row> = {}): Row {
  const numbers = Array.from({ length: passes }, (_, i) => i + 1);
  return {
    index: 0,
    item_id: 'm3-001',
    status: 'completed',
    metric_values: [1],
    input_preview: 'ما هو إجمالي المبيعات',
    output_digest: 'row',
    __has_output: true,
    metric_meta: { accuracy: compactAccuracy() },
    pass_metric_meta: { accuracy: numbers.map(() => compactAccuracy()) },
    pass_attempts: numbers.map(attempt),
    __details_loaded: false,
    ...over,
  } as Row;
}

/** What the details loader stores for the row: the full answer over the compact row. */
function loadedRow(passes = 2): Row {
  const compact = compactRow(passes);
  const numbers = Array.from({ length: passes }, (_, i) => i + 1);
  return {
    ...compact,
    input: { question: 'ما هو إجمالي المبيعات' },
    output: 'SELECT 1',
    metric_meta: { accuracy: fullAccuracy(passes) },
    pass_metric_meta: { accuracy: numbers.map(fullAccuracy) },
    pass_attempts: numbers.map((p) => ({ ...attempt(p), output: `SELECT ${p}` })),
    __details_loaded: true,
  } as Row;
}

const payload = (rows: Row[]): RunPayload =>
  ({
    run: { run_id: 'r1', status: 'RUNNING' },
    snapshot: { rows, stats: {}, metric_names: ['accuracy'], detail_mode: 'lazy' },
  }) as unknown as RunPayload;

describe('the metric metadata of a loaded row across a live refresh (I14)', () => {
  it('keeps the two tables and the long text when the compact values agree', () => {
    const old = loadedRow();
    const next = inheritLoadedBodies(old, compactRow());
    expect(next.__details_loaded).toBe(true);
    const pass2 = next.pass_metric_meta!.accuracy![1] as Record<string, unknown>;
    expect(pass2.expected_rows).toEqual(TABLE);
    expect(pass2.actual_rows).toEqual(TABLE);
    expect(pass2.llm_judge_reasoning).toContain('(pass 2)');
    expect(pass2.explanation).toBe('Pass 2 matches the reference.');
    expect((next.metric_meta!.accuracy as Record<string, unknown>).expected_rows).toEqual(TABLE);
  });

  it('keeps the same row object when nothing but the compaction differs', () => {
    const old = loadedRow();
    const prev = payload([old]);
    const after = reuseRows(prev, payload([compactRow()]));
    // the whole payload is reused: the open pane re-renders nothing
    expect(after).toBe(prev);
    expect(after.snapshot.rows[0]).toBe(old);
  });

  it('survives many refreshes in a row', () => {
    let current = payload([loadedRow()]);
    for (let i = 0; i < 5; i++) current = reuseRows(current, payload([compactRow()]));
    const row = current.snapshot.rows[0]!;
    expect(row.__details_loaded).toBe(true);
    expect((row.pass_metric_meta!.accuracy![0] as Record<string, unknown>).expected_rows).toEqual(TABLE);
  });

  it('reloads the row when a value the index kept moved (a score edit, a new verdict)', () => {
    const old = loadedRow();
    const moved = compactRow(2, {
      pass_metric_meta: { accuracy: [compactAccuracy(), { exact_match_cell_f1: 50, exact_match_result_score: false }] },
    } as Partial<Row>);
    const next = inheritLoadedBodies(old, moved);
    expect(next.__details_loaded).toBe(false);
    // the row carries the new compact values, never the old full ones under a new score
    expect(next.pass_metric_meta!.accuracy![1]).toEqual({ exact_match_cell_f1: 50, exact_match_result_score: false });
  });

  it('reloads the row when a new pass arrives', () => {
    const old = loadedRow(2);
    const next = inheritLoadedBodies(old, compactRow(3));
    expect(next.__details_loaded).toBe(false);
  });

  it('keeps an empty compact metadata (tables only) as the full one', () => {
    const old = { ...loadedRow(1), pass_metric_meta: { accuracy: [{ expected_rows: TABLE, actual_rows: TABLE }] } } as Row;
    const next = inheritMetricMeta(old, compactRow(1, { pass_metric_meta: { accuracy: [{}] } } as Partial<Row>));
    expect(next.current).toBe(true);
    expect(next.pass_metric_meta!.accuracy![0]).toEqual({ expected_rows: TABLE, actual_rows: TABLE });
  });

  it('leaves a row that was never loaded alone', () => {
    const fresh = compactRow();
    expect(inheritLoadedBodies(compactRow(), fresh)).toBe(fresh);
  });
});

describe('sameJson', () => {
  it('compares values, not key order', () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson(null, undefined)).toBe(false);
  });
});
