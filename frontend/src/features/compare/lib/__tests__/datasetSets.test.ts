/** Multi-dataset round, QC-U38 to QC-U40: which dataset versions compared runs evaluated. */
import { describe, expect, it } from 'vitest';
import { datasetSetOf, datasetSetsDiffer, datasetSummary } from '../datasetSets';
import { differingContext } from '../runInfo';
import type { Run } from '@/features/run-detail/types';

const single = (name: string, version: string) =>
  ({ run_id: name, dataset_name: name, dataset_version: version }) as Run;
const union = (...names: Array<[string, string]>) =>
  ({
    run_id: 'u',
    dataset_name: names.map(([n, v]) => `${n}@${v}`).join(' + '),
    dataset_count: names.length,
    datasets: names.map(([dataset, version], position) => ({ position, dataset, version, deleted: false })),
  }) as unknown as Run;

describe('dataset sets', () => {
  it('sorts the entries so list order never matters', () => {
    expect(datasetSetOf(union(['b', 'v1'], ['a', 'v2']))).toEqual(['a␟v2', 'b␟v1']);
  });

  it('differs only when a union run is among the compared runs and the sets are not equal', () => {
    expect(datasetSetsDiffer([union(['a', 'v1'], ['b', 'v1']), single('a', 'v1')])).toBe(true);
    expect(datasetSetsDiffer([union(['a', 'v1'], ['b', 'v1']), union(['b', 'v1'], ['a', 'v1'])])).toBe(false);
    // two single runs keep today's generic note
    expect(datasetSetsDiffer([single('a', 'v1'), single('a', 'v2')])).toBe(false);
  });

  it('lists the datasets among the differing settings as a count or name and version', () => {
    const diff = differingContext([union(['a', 'v1'], ['b', 'v1'], ['c', 'v1']), single('a', 'v1')]);
    expect(diff).toContainEqual({ group: 'Datasets', key: 'datasets', values: ['3 datasets', 'a v1'] });
    expect(datasetSummary(single('a', 'v1'))).toBe('a v1');
  });
});
