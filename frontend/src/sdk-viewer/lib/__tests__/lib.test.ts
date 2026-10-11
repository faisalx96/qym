import { describe, expect, it } from 'vitest';
import type { Row } from '../../types';
import { metricCell, formatScore, toNumber } from '../metric-cell';
import { latencySummary, percentile, formatLatency, formatElapsed } from '../stats';
import { wordDiff } from '../diff';
import { DEFAULT_VIEW, filterRows, parseView, rowsToCsv, sortRows, viewToSearch } from '../table-model';

function row(over: Partial<Row>): Row {
  return {
    index: 0,
    status: 'completed',
    input: '',
    input_full: 'in',
    output: '',
    output_full: 'out',
    expected: '',
    expected_full: 'exp',
    metric_values: ['1'],
    metric_meta: {},
    time: '',
    latency_ms: 100,
    trace_id: null,
    trace_url: null,
    ...over,
  };
}

describe('metricCell', () => {
  it.each([
    ['1', 'pass'],
    ['1.0', 'pass'],
    ['✓', 'pass'],
    ['true', 'pass'],
    ['0', 'fail'],
    ['0.0', 'fail'],
    ['✗', 'fail'],
    ['no', 'fail'],
    ['n/a', 'na'],
    ['pending', 'na'],
    ['computing...', 'na'],
    ['', 'na'],
    ['error', 'na'],
    ['0.83', 'score'],
    ['maybe', 'score'],
  ])('%s -> %s', (value, kind) => expect(metricCell(value).kind).toBe(kind));

  it('parses numbers and formats them', () => {
    expect(toNumber('0.5')).toBe(0.5);
    expect(toNumber('12%')).toBe(12);
    expect(toNumber('abc')).toBeNull();
    expect(formatScore(metricCell('0.83333'))).toBe('0.833');
    expect(formatScore(metricCell('n/a'))).toBe('n/a');
  });
});

describe('stats', () => {
  it('interpolates percentiles and ignores unknown latencies', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    const rows = [
      row({ latency_ms: 100 }),
      row({ latency_ms: 300 }),
      row({ latency_ms: null }),
      row({ latency_ms: 0 }),
      row({ status: 'error', latency_ms: 9999 }),
    ];
    expect(latencySummary(rows)).toMatchObject({ count: 2, min: 100, p50: 200, max: 300 });
    expect(latencySummary([row({ latency_ms: null })])).toBeNull();
  });
  it('formats', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(344.15)).toBe('344 ms');
    expect(formatLatency(1500)).toBe('1.50 s');
    expect(formatElapsed(75)).toBe('1:15');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });
});

describe('wordDiff', () => {
  it('marks only the differing words, not everything after an insertion', () => {
    const parts = wordDiff('the quick brown fox', 'the very quick brown fox');
    expect(parts.filter((p) => p.type === 'del')).toHaveLength(0);
    expect(parts.find((p) => p.type === 'ins')?.text.trim()).toBe('very');
  });
  it('is one same part for equal text', () =>
    expect(wordDiff('a b', 'a b')).toEqual([{ type: 'same', text: 'a b' }]));
});

describe('table model', () => {
  const rows = [
    row({ index: 0, input_full: 'Hello', metric_values: ['0.9'], latency_ms: 300 }),
    row({ index: 1, status: 'error', output_full: 'boom', metric_values: ['n/a'], latency_ms: null }),
    row({ index: 2, status: 'in_progress', metric_values: ['pending'], latency_ms: null }),
    row({ index: 3, metric_values: ['0.2'], latency_ms: 100 }),
  ];
  it('filters by text and status', () => {
    expect(filterRows(rows, { q: 'hello', status: 'all' }).map((r) => r.index)).toEqual([0]);
    expect(filterRows(rows, { q: '', status: 'error' }).map((r) => r.index)).toEqual([1]);
    expect(filterRows(rows, { q: 'boom', status: 'completed' })).toEqual([]);
  });
  it('sorts metrics numerically with unknown values last in both directions', () => {
    expect(sortRows(rows, 'metric:0', 'asc').map((r) => r.index)).toEqual([3, 0, 1, 2]);
    expect(sortRows(rows, 'metric:0', 'desc').map((r) => r.index)).toEqual([0, 3, 1, 2]);
    expect(sortRows(rows, 'latency', 'desc').map((r) => r.index)).toEqual([0, 3, 1, 2]);
    expect(sortRows(rows, 'status', 'asc').map((r) => r.index)).toEqual([1, 2, 0, 3]);
  });
  it('round-trips the view through the URL and ignores junk', () => {
    const view = { q: 'foo', status: 'error' as const, sort: 'metric:1' as const, dir: 'desc' as const };
    expect(parseView(viewToSearch(view))).toEqual(view);
    expect(viewToSearch(DEFAULT_VIEW)).toBe('');
    expect(parseView('?status=zzz&sort=nope&dir=up')).toEqual(DEFAULT_VIEW);
  });
  it('exports csv with escaping and formula guard', () => {
    const csv = rowsToCsv(
      [row({ index: 0, output_full: 'a,"b"', input_full: '=1+1', metric_values: ['1'] })],
      ['m'],
    );
    expect(csv).toContain('index,status,input,output,expected,m,latency_ms');
    expect(csv).toContain(`"'=1+1"`.replace(`"'=1+1"`, "'=1+1"));
    expect(csv).toContain('"a,""b"""');
  });
});
