/** Multi-dataset round, QC-U22 to QC-U28: the Dataset filter of a union run and its URL form. */
import { describe, expect, it } from 'vitest';
import { applyItemFilters, emptyView, readRunView, writeRunView } from '../filterRules';
import { datasetKey, datasetKeyLabel, datasetKeyParts, rowDatasetKey, rowRawItemId } from '../datasetFilter';
import { buildRunModel } from '../runModel';
import { discoverColumns } from '../csv';
import type { Row, RunPayload } from '../../types';

const row = (index: number, ds: string, version: string | null, raw: string): Row =>
  ({
    index,
    item_id: `${ds}@${version}/${raw}`,
    status: 'completed',
    item_metadata: { qym_dataset: ds, qym_dataset_version: version, qym_dataset_index: 0, qym_item_id: raw },
    scores: {},
  }) as unknown as Row;

describe('dataset keys', () => {
  it('builds name@version, a bare name for a local file, and reads both back', () => {
    expect(datasetKey('support-tickets', 'v4')).toBe('support-tickets@v4');
    expect(datasetKey('local.csv', null)).toBe('local.csv');
    expect(datasetKeyParts('a@b@v3')).toEqual({ name: 'a@b', version: 'v3' });
    expect(datasetKeyParts('local.csv')).toEqual({ name: 'local.csv', version: null });
    expect(datasetKeyLabel('support-tickets@v4')).toBe('support-tickets v4');
  });

  it('reads the source of a row from its tags and the raw item id', () => {
    const r = row(0, 'support-tickets', 'v3', 't-0007');
    expect(rowDatasetKey(r)).toBe('support-tickets@v3');
    expect(rowRawItemId(r)).toBe('t-0007');
    expect(rowDatasetKey({ index: 0, item_id: 'x', item_metadata: {} } as unknown as Row)).toBeNull();
  });
});

const payload = {
  run: { run_id: 'r', metric_names: ['m'], dataset_count: 2 },
  snapshot: {
    rows: [row(0, 'a', 'v1', 't-1'), row(1, 'a', 'v2', 't-1'), row(2, 'b', 'v1', 'b-1')],
    stats: { total: 3, completed: 3 },
    metric_names: ['m'],
  },
} as unknown as RunPayload;

describe('the filter', () => {
  it('keeps two items that share a raw id apart and narrows to one dataset', () => {
    const model = buildRunModel(payload);
    const ctx = { model, thresholds: {}, selectedMetric: null, repeatAggregate: false };
    const all = applyItemFilters(ctx, emptyView(), []);
    expect(all.map((i) => i.row.item_id)).toEqual(['a@v1/t-1', 'a@v2/t-1', 'b@v1/b-1']);
    const one = applyItemFilters(ctx, { ...emptyView(), dataset: 'a@v2' }, []);
    expect(one.map((i) => i.row.item_id)).toEqual(['a@v2/t-1']);
  });

  it('round-trips through the dataset URL param and leaves other views alone', () => {
    const model = buildRunModel(payload);
    const ctx = { model, metricNames: ['m'], metadataKeys: [], rows: model.rows, repeatAggregate: false };
    const view = readRunView(new URLSearchParams('dataset=a%40v2'), ctx);
    expect(view.dataset).toBe('a@v2');
    expect(writeRunView(view, model, []).dataset).toBe('a@v2');
    expect(readRunView(new URLSearchParams(''), ctx).dataset).toBeNull();
    expect(writeRunView(emptyView(), model, []).dataset).toBeNull();
  });
});

describe('the CSV export', () => {
  it('adds dataset and dataset_version after the item id for a union run only', () => {
    const model = buildRunModel(payload);
    const union = discoverColumns(payload.snapshot.rows, model).map((c) => c.id);
    expect(union.slice(union.indexOf('item_id'), union.indexOf('item_id') + 3)).toEqual([
      'item_id',
      'dataset',
      'dataset_version',
    ]);
    const plain = discoverColumns(
      [{ index: 0, item_id: 'x', item_metadata: {} } as unknown as Row],
      model,
    ).map((c) => c.id);
    expect(plain).not.toContain('dataset');
  });
});
