/** The compare page title (K1, C245; K2, C215): it names what is compared, in the page and the browser tab. */
import type { MetricColumn } from './baseline';
import type { CompareModel } from './model';

function runName(model: CompareModel, base: string): string {
  const run = model.runs.find((r) => r.base === base)?.run;
  return String(run?.base_run_name || run?.run_name || base).replace(/ · pass \d+$/, '');
}

/**
 * The passes of one repeat run: "12 passes of <run>". Two runs: "<run> vs <baseline>". More runs: "<N> runs on
 * <dataset>", or "<N> runs" when they evaluated different datasets.
 */
export function compareTitle(model: CompareModel, baseline: Pick<MetricColumn, 'base'> | null): string {
  const bases = model.bases;
  if (bases.length === 1 && bases[0]) return `${model.runs.length} passes of ${runName(model, bases[0])}`;
  if (bases.length === 2) {
    const base = baseline?.base && bases.includes(baseline.base) ? baseline.base : bases[0]!;
    const other = bases.find((b) => b !== base) ?? bases[1]!;
    return `${runName(model, other)} vs ${runName(model, base)}`;
  }
  const datasets = new Set(
    bases.map((b) => String(model.runs.find((r) => r.base === b)?.run.dataset_name ?? '').trim()),
  );
  const [dataset] = Array.from(datasets);
  return datasets.size === 1 && dataset ? `${bases.length} runs on ${dataset}` : `${bases.length} runs`;
}
