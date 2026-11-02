import { describe, expect, it } from 'vitest';
import { datasetEntries, datasetKey, rowDataset } from '../datasets';
import { filterRows, parseView, rowsToCsv, viewToSearch } from '../table-model';
import type { Row } from '../../types';

const row = (
  index: number,
  position: number,
  name: string,
  version: string | null,
  score: string,
  status: Row['status'] = 'completed',
): Row =>
  ({
    index,
    status,
    input: 'i',
    input_full: 'i',
    output: 'o',
    output_full: 'o',
    expected: 'e',
    expected_full: 'e',
    metric_values: [score],
    metric_meta: {},
    time: '1',
    latency_ms: 1,
    trace_id: null,
    trace_url: null,
    item_id: `${name}@${version}/${index}`,
    item_metadata: {
      qym_dataset: name,
      qym_dataset_version: version,
      qym_dataset_index: position,
      qym_item_id: String(index),
    },
  }) as Row;

const rows = [
  row(0, 0, 'alpha', 'v1', '1'),
  row(1, 0, 'alpha', 'v1', '0.5'),
  row(2, 1, 'beta', null, '0', 'error'),
];

describe('union rows in the local viewer', () => {
  it('reads the source of a row and tells a file without tags', () => {
    expect(rowDataset(rows[0]!)).toEqual({ position: 0, name: 'alpha', version: 'v1' });
    expect(rowDataset({ ...rows[0]!, item_metadata: {} })).toBeNull();
    expect(datasetKey('beta', null)).toBe('beta');
  });

  it('computes items, failures and means per dataset from the rows, only for two or more datasets', () => {
    const entries = datasetEntries(rows, 1);
    expect(entries.map((e) => [e.key, e.items, e.failed, e.means[0]])).toEqual([
      ['alpha@v1', 2, 0, 0.75],
      ['beta', 1, 1, 0],
    ]);
    expect(datasetEntries(rows.slice(0, 2), 1)).toEqual([]);
  });

  it('filters rows by the dataset key, round-trips the URL and adds the CSV columns', () => {
    expect(filterRows(rows, { q: '', status: 'all', dataset: 'alpha@v1' })).toHaveLength(2);
    expect(
      parseView(viewToSearch({ q: '', status: 'all', sort: 'index', dir: 'asc', dataset: 'beta' })).dataset,
    ).toBe('beta');
    expect(parseView('').dataset).toBeUndefined();
    expect(rowsToCsv(rows, ['m']).split('\r\n')[0]).toContain('dataset,dataset_version');
  });
});
