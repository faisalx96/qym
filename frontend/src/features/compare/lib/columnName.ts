/** The display name of a comparison column (a run, or one pass of a repeat run). */
import type { MetricColumn } from './baseline';
import { runShortName } from './labels';
import type { CompareModel } from './model';

export function columnName(model: CompareModel, col: MetricColumn): string {
  const run = model.runs[col.runIdxs[0] ?? 0];
  return runShortName({ label: col.label, pass: col.pass, run: run?.run });
}
