/**
 * Loaded bodies across a compact refetch (October 2026 bug: a repeat run's per-pass outputs were replaced by the
 * compact attempts while the row still counted as loaded, so the card showed "No output was recorded").
 */
import { describe, expect, it } from 'vitest';
import { hydrateAttempts, inheritLoadedBodies, mergeRow, reuseRows, rowSignature } from '../rowSignature';
import type { Row, RunPayload } from '../../types';

const compactAttempt = (pass: number, digest: string) => ({
  pass_number: pass,
  status: 'completed',
  latency_ms: 100 * pass,
  output_digest: digest,
  __has_output: true,
  __execution_error: '',
});

function compactRow(over: Partial<Row> = {}): Row {
  return {
    index: 1,
    item_id: 'sql-002',
    status: 'completed',
    metric_values: [1, 0.5],
    input_preview: 'List customers',
    output_digest: 'row-digest',
    __has_output: true,
    pass_attempts: [compactAttempt(1, 'd1'), compactAttempt(2, 'd2'), compactAttempt(3, 'd3')],
    __details_loaded: false,
    ...over,
  } as Row;
}

/** What the details loader stores: the full answer over the compact row, attempts hydrated. */
function loadedRow(): Row {
  const compact = compactRow();
  const full = {
    input: 'List customers',
    expected: 'SELECT name FROM customers',
    output: 'SELECT name FROM customers ORDER BY revenue',
    pass_attempts: [1, 2, 3].map((p) => ({
      pass_number: p,
      status: 'completed',
      latency_ms: 100 * p,
      output: `SELECT name FROM customers -- pass ${p}`,
    })),
  };
  return {
    ...compact,
    ...full,
    pass_attempts: hydrateAttempts(compact.pass_attempts, full.pass_attempts),
    __details_loaded: true,
  } as Row;
}

const payload = (rows: Row[]): RunPayload =>
  ({
    run: { run_id: 'r1' },
    snapshot: { rows, stats: {}, metric_names: [], detail_mode: 'lazy' },
  }) as unknown as RunPayload;

describe('hydrateAttempts', () => {
  it('keeps the compact digest and flags under the full output', () => {
    const row = loadedRow();
    expect(row.pass_attempts?.[1]).toMatchObject({
      pass_number: 2,
      output: 'SELECT name FROM customers -- pass 2',
      output_digest: 'd2',
      __has_output: true,
    });
  });
  it('matches by position when attempts carry no pass number', () => {
    const out = hydrateAttempts(
      [{ output_digest: 'a' }, { output_digest: 'b' }],
      [{ output: 'A' }, { output: 'B' }],
    );
    expect(out).toEqual([
      { output_digest: 'a', output: 'A' },
      { output_digest: 'b', output: 'B' },
    ]);
  });
});

describe('rowSignature', () => {
  it("ignores the attempts' outputs, so a loaded row equals its compact refetch", () => {
    expect(rowSignature(loadedRow())).toBe(rowSignature(compactRow()));
  });
  it('still sees a changed attempt digest or status', () => {
    const changed = compactRow({
      pass_attempts: [compactAttempt(1, 'd1'), compactAttempt(2, 'd2-new'), compactAttempt(3, 'd3')],
    });
    expect(rowSignature(changed)).not.toBe(rowSignature(loadedRow()));
  });
});

describe('reuseRows after a compact refetch', () => {
  it('an unchanged row keeps its object and every pass output', () => {
    const prev = payload([loadedRow()]);
    const next = reuseRows(prev, payload([compactRow()]));
    expect(next).toBe(prev);
  });
  it('a changed row (new score) inherits the row and pass outputs and stays loaded', () => {
    const prev = payload([loadedRow()]);
    const fresh = compactRow({ metric_values: [0, 0.5] });
    const next = reuseRows(prev, payload([fresh]));
    const row = next.snapshot.rows[0]!;
    expect(row.metric_values).toEqual([0, 0.5]);
    expect(row.__details_loaded).toBe(true);
    expect(row.output).toBe('SELECT name FROM customers ORDER BY revenue');
    expect(row.pass_attempts?.map((a) => a?.output)).toEqual([
      'SELECT name FROM customers -- pass 1',
      'SELECT name FROM customers -- pass 2',
      'SELECT name FROM customers -- pass 3',
    ]);
    expect(row.pass_attempts?.[0]).toMatchObject({ output_digest: 'd1', __has_output: true });
  });
  it('a pass whose output digest moved makes the row not loaded again (the card refetches)', () => {
    const prev = payload([loadedRow()]);
    const fresh = compactRow({
      pass_attempts: [compactAttempt(1, 'd1'), compactAttempt(2, 'd2'), compactAttempt(3, 'd3-rerun')],
    });
    const row = reuseRows(prev, payload([fresh])).snapshot.rows[0]!;
    expect(row.__details_loaded).toBe(false);
  });
  it('a moved row digest makes the row not loaded again', () => {
    const prev = payload([loadedRow()]);
    const row = reuseRows(
      prev,
      payload([compactRow({ output_digest: 'row-digest-2', metric_values: [0, 0] })]),
    ).snapshot.rows[0]!;
    expect(row.__details_loaded).toBe(false);
  });
  it('a new pass that has an output the old row never loaded is not invented', () => {
    const prev = payload([loadedRow()]);
    const fresh = compactRow({ pass_attempts: [...compactRow().pass_attempts!, compactAttempt(4, 'd4')] });
    const row = reuseRows(prev, payload([fresh])).snapshot.rows[0]!;
    expect(row.__details_loaded).toBe(false);
    expect(row.pass_attempts?.[3]).not.toHaveProperty('output');
  });
});

describe('mergeRow', () => {
  it('a full mutation row replaces bodies and stays loaded', () => {
    const prev = payload([loadedRow()]);
    const next = mergeRow(prev, {
      ...compactRow(),
      output: 'patched',
      pass_attempts: [1, 2, 3].map((p) => ({ pass_number: p, status: 'completed', output: `patched ${p}` })),
      __details_loaded: undefined,
    } as unknown as Row);
    const row = next.snapshot.rows[0]!;
    expect(row.__details_loaded).toBe(true);
    expect(row.output).toBe('patched');
    expect(row.pass_attempts?.[2]?.output).toBe('patched 3');
  });
  it('a compact mutation row inherits the loaded bodies', () => {
    const prev = payload([loadedRow()]);
    const row = mergeRow(prev, compactRow({ metric_values: [0, 0] })).snapshot.rows[0]!;
    expect(row.__details_loaded).toBe(true);
    expect(row.pass_attempts?.[1]?.output).toBe('SELECT name FROM customers -- pass 2');
  });
});

describe('inheritLoadedBodies', () => {
  it('leaves a row alone when the old one was never loaded', () => {
    const fresh = compactRow();
    expect(inheritLoadedBodies(compactRow(), fresh)).toBe(fresh);
  });
});
