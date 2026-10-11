/** Best-run picker helpers (B15): scope query, base header and labels. */
import { sameValue } from './pointers';
import type { BaseInfo } from './types';

export const BEST_RUN_LIMIT = 5;

export const BEST_RUN_REASONS: Record<string, string> = {
  custom_dataset: 'Runs on a custom dataset string are never ranked. Pick a project dataset to see best runs.',
  unknown_dataset_version: 'That dataset version or alias does not exist.',
  no_metric: 'No metric to rank by yet.',
  no_runs_on_version: 'No official run on this dataset version yet.',
  no_runs_in_scope: 'No official run matches this scope.',
  no_runs_for_metric: 'No official run in this scope has this metric.',
  all_excluded: 'Every run in this scope errored on more than 20% of its items. Include errored runs to see them.',
};

export const VERSION_LABELS: Record<string, string> = { agent_version: 'agent', kb_version: 'kb' };

export interface BestRunScope {
  datasetId?: string;
  versionId?: string;
  /** One value per versioning key. */
  versioning?: Record<string, string>;
  metric?: string;
  includeErrored?: boolean;
  limit?: number;
}

/** Query string of GET …/best-runs for a scope ('Any' parts are left out). */
export function bestRunQuery(scope: BestRunScope): string {
  const q = new URLSearchParams();
  if (scope.datasetId) q.set('dataset_id', scope.datasetId);
  if (scope.versionId) q.set('dataset_version_id', scope.versionId);
  const versioning = scope.versioning ?? {};
  for (const key of Object.keys(versioning).sort()) q.append('versioning', `${key}=${versioning[key]}`);
  if (scope.metric) q.set('metric', scope.metric);
  if (scope.includeErrored) q.set('exclude_errored', 'false');
  q.set('limit', String(scope.limit ?? BEST_RUN_LIMIT));
  return q.toString();
}

export function formatScore(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return String(Number(value.toFixed(Math.abs(value) >= 100 ? 1 : 3)));
}

export function formatAge(seconds: unknown): string {
  if (typeof seconds !== 'number') return '—';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** "agent v1.12 / kb 381" (other keys follow as "key value"). */
export function versionText(versioning: unknown): string {
  if (!versioning || typeof versioning !== 'object') return '';
  const v = versioning as Record<string, unknown>;
  const keys = Object.keys(v).filter((k) => v[k] != null && typeof v[k] !== 'object');
  keys.sort((a, b) => (VERSION_LABELS[a] ? 0 : 1) - (VERSION_LABELS[b] ? 0 : 1) || (a < b ? -1 : 1));
  return keys.map((k) => `${VERSION_LABELS[k] ?? k} ${String(v[k])}`).join(' / ');
}

/** "run abc12345 · accuracy 0.84 · agent v1.12 / kb 381" */
export function bestRunHeader(info: Pick<BaseInfo, 'runId' | 'metric' | 'score'> & { versioning?: unknown }): string {
  if (!info.runId) return '';
  const parts = [`run ${info.runId.slice(0, 8)}`];
  if (info.metric) parts.push(`${info.metric} ${formatScore(info.score)}`);
  const versions = versionText(info.versioning);
  if (versions) parts.push(versions);
  return parts.join(' · ');
}

/** Drift lines: "agent: v1 in this run, v2 now". */
export function driftLines(drift: BaseInfo['drift']): string[] {
  if (!drift || drift.status !== 'changed') return [];
  return (drift.changes ?? []).map((c) => {
    const label = VERSION_LABELS[c.key] ?? c.key;
    return `${label}: ${c.run == null ? 'none' : String(c.run)} in this run, ${c.latest == null ? 'none' : String(c.latest)} now`;
  });
}

export function sameScope(a: BestRunScope, b: BestRunScope): boolean {
  return sameValue(bestRunQuery(a), bestRunQuery(b));
}
