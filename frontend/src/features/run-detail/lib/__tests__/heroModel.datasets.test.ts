/** Multi-dataset round, QC-U3 / QC-U4 / QC-U9: the Datasets group of the header chips and the count tag text. */
import { describe, expect, it } from 'vitest';
import { datasetEntryLink, datasetsTitle, headerChips, isUnionRun } from '../heroModel';
import type { Run, RunDatasetEntry } from '../../types';

const entry = (over: Partial<RunDatasetEntry>): RunDatasetEntry => ({
  position: 0,
  dataset: 'support-tickets',
  dataset_slug: 'support-tickets',
  version: 'v3',
  alias: null,
  items: 412,
  deleted: false,
  ...over,
});
const run = (over: Partial<Run>) => ({ run_id: 'r1', ...over }) as Run;
const union = run({
  dataset_count: 3,
  versioning_details: { agent_version: 'v2' },
  datasets: [
    entry({}),
    entry({ position: 1, version: 'v4', items: 438 }),
    entry({
      position: 2,
      dataset: 'billing-faq',
      dataset_slug: 'billing-faq',
      version: 'v7',
      alias: 'production',
      items: 96,
    }),
  ],
});

describe('the Datasets group', () => {
  it('leads the band, one chip per entry in list order', () => {
    const groups = headerChips(union);
    expect(groups.map((g) => g.label)).toEqual(['Datasets', 'Versioning']);
    expect(groups[0]!.chips.map((c) => `${c.dataset!.dataset} ${c.dataset!.version}`)).toEqual([
      'support-tickets v3',
      'support-tickets v4',
      'billing-faq v7',
    ]);
  });

  it('exists only for a run over several datasets', () => {
    expect(isUnionRun(union)).toBe(true);
    expect(isUnionRun(run({}))).toBe(false);
    expect(isUnionRun(run({ dataset_count: 1, datasets: [entry({})] }))).toBe(false);
    expect(headerChips(run({ dataset_count: 1, datasets: [entry({})] }))).toEqual([]);
  });

  it('titles the count tag with name and version of every entry', () => {
    expect(datasetsTitle(union.datasets!)).toBe('support-tickets v3, support-tickets v4, billing-faq v7');
  });

  it('links a live dataset to its version and never a deleted one', () => {
    expect(datasetEntryLink('demo', entry({}))).toBe('/projects/demo/datasets/support-tickets?v=v3');
    expect(datasetEntryLink('demo', entry({ deleted: true, dataset_slug: null }))).toBeNull();
    expect(datasetEntryLink(undefined, entry({}))).toBeNull();
  });

  it('keeps the SDK list out of the metadata chips', () => {
    const groups = headerChips(
      run({
        dataset_count: 2,
        datasets: [entry({}), entry({ position: 1 })],
        metadata: { datasets: [{ dataset: 'x' }], env: 'ci' },
      }),
    );
    const metadata = groups.find((g) => g.label === 'Metadata');
    expect(metadata?.chips.map((c) => c.key)).toEqual(['env']);
  });
});
