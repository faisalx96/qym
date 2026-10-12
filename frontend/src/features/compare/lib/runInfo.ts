/** What the run summary cards show: counts, owner, version, and which config / version keys differ between the runs. */
import { isErrorRow } from '@/lib/metrics';
import type { Run, RunPayload } from '@/features/run-detail/types';

export interface RunCounts {
  items: number;
  completed: number;
  errors: number;
}

/** Items / completed from the snapshot stats; errors = items with a task or scorer error (as the Metrics tab counts them). */
export function runCounts(p: RunPayload): RunCounts {
  const stats = p.snapshot.stats;
  const rows = p.snapshot.rows ?? [];
  const items = stats?.total ?? rows.length;
  const completed = stats?.completed ?? rows.filter((r) => r.status === 'completed').length;
  // Items with a task or scorer error: the count the Errors column and Metrics tab show.
  const errors = rows.filter((r) => isErrorRow(r)).length;
  return { items, completed, errors };
}

export function ownerLabel(run: Run): string {
  return run.owner?.display_name || run.owner?.email || run.owner?.id || '';
}

const asText = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Config keys that never help a comparison (identity, timestamps, huge blobs). */
const SKIP_KEYS = new Set(['qym_config', 'qym_launch', 'run_name', 'started_at', 'task_started_at_ms']);

export interface DifferingKey {
  group: 'Git' | 'Config' | 'Versioning';
  key: string;
  /** One value per run, in the order given ('' = not set). */
  values: string[];
}

/** Keys whose value is not the same on every run (git branch / commit, config, versioning details). */
export function differingContext(runs: Run[]): DifferingKey[] {
  if (runs.length < 2) return [];
  const out: DifferingKey[] = [];
  const consider = (group: DifferingKey['group'], key: string, values: string[]) => {
    if (new Set(values).size > 1) out.push({ group, key, values });
  };
  consider('Git', 'branch', runs.map((r) => asText(r.git_branch)));
  consider('Git', 'commit', runs.map((r) => asText(r.git_commit).slice(0, 10)));
  const keysOf = (pick: (r: Run) => Record<string, unknown> | undefined) => {
    const keys = new Set<string>();
    runs.forEach((r) => Object.keys(pick(r) ?? {}).forEach((k) => !SKIP_KEYS.has(k) && keys.add(k)));
    return Array.from(keys).sort();
  };
  for (const k of keysOf((r) => r.config)) consider('Config', k, runs.map((r) => asText(r.config?.[k])));
  for (const k of keysOf((r) => r.versioning_details)) consider('Versioning', k, runs.map((r) => asText(r.versioning_details?.[k])));
  return out;
}
