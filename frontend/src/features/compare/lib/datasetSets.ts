/** Which dataset versions a run evaluated (a union run lists several), and whether compared runs share them. */
import type { Run } from '@/features/run-detail/types';

export const runDatasetCount = (run: Pick<Run, 'dataset_count'>): number => run.dataset_count ?? 1;

/** `name␟version` of every dataset version of a run, sorted: two runs evaluated the same data when these match. */
export function datasetSetOf(run: Run): string[] {
  const entries =
    runDatasetCount(run) > 1 && run.datasets?.length
      ? run.datasets.map((d) => `${d.dataset}␟${d.version ?? ''}`)
      : [`${run.dataset_name ?? ''}␟${run.dataset_version ?? ''}`];
  return Array.from(new Set(entries)).sort();
}

/** One cell of "What differs": `3 datasets`, or `support-tickets v3` for a single dataset. */
export function datasetSummary(run: Run): string {
  if (runDatasetCount(run) > 1) return `${runDatasetCount(run)} datasets`;
  const version = run.dataset_version != null && run.dataset_version !== '' ? ` ${run.dataset_version}` : '';
  return `${run.dataset_name ?? ''}${version}`.trim();
}

/** Whether any compared run is a union run and the runs do not all evaluate the same set of dataset versions. */
export function datasetSetsDiffer(runs: Run[]): boolean {
  if (runs.length < 2 || !runs.some((r) => runDatasetCount(r) > 1)) return false;
  return new Set(runs.map((r) => datasetSetOf(r).join('␞'))).size > 1;
}
