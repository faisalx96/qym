/** Hero derivations (run.html renderSummary / runEntityLinks / buildExecutionContextSectionHtml). */
import { projectPath } from '@/app/routes';
import { stringify } from './rowErrors';
import type { IngestIncomplete, PassSummary, Run } from '../types';

const HIDDEN_CONFIG_KEYS = new Set([
  'run_name',
  'task_name',
  'task',
  'git_branch',
  'git_commit',
  'model',
  'model_name',
  'dataset',
  'dataset_name',
  'samples',
  'max_metric_concurrency',
  'MAX_METRIC_CONCURRENCY',
]);
const HIDDEN_METADATA_KEYS = new Set([
  'langfuse_url',
  'langfuse_host',
  'langfuse_project_id',
  'trace_stats',
  'snapshot',
  'rows',
  'metric_names',
  'task_name',
  'model',
  'model_name',
  'dataset',
  'dataset_name',
  'total_items',
  'samples',
  'last_completed_pass',
  'git_branch',
  'git_commit',
  'ingest_incomplete',
  'ingest_rejected',
  'pass_revision',
  'analysis_aggregation',
  'has_repeat_pass_context',
]);

export interface ContextEntry {
  key: string;
  label: string;
  group: 'Config' | 'Metadata';
  value: string;
  raw: unknown;
  /** Objects, arrays and JSON-looking strings open the JSON viewer. */
  json: boolean;
}

export function formatFieldLabel(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksJson(value: unknown): boolean {
  if (value !== null && typeof value === 'object') return true;
  if (typeof value !== 'string') return false;
  const t = value.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return false;
  try {
    const parsed: unknown = JSON.parse(t);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

export function executionContextEntries(run: Run): ContextEntry[] {
  const config = run.config ?? {};
  const metadata = run.metadata ?? {};
  const hiddenMeta = new Set(HIDDEN_METADATA_KEYS);
  if (run.experiment) {
    hiddenMeta.add('qym_config');
    hiddenMeta.add('qym_launch');
  }
  const entries: ContextEntry[] = [];
  const seen = new Set<string>();
  Object.entries(config).forEach(([key, value]) => {
    if (HIDDEN_CONFIG_KEYS.has(key) || value == null || value === '') return;
    seen.add(key.toLowerCase());
    entries.push({
      key,
      label: formatFieldLabel(key),
      group: 'Config',
      value: stringify(value),
      raw: value,
      json: looksJson(value),
    });
  });
  Object.entries(metadata).forEach(([key, value]) => {
    if (hiddenMeta.has(key) || value == null || value === '') return;
    if (seen.has(key.toLowerCase())) return;
    entries.push({
      key,
      label: formatFieldLabel(key),
      group: 'Metadata',
      value: stringify(value),
      raw: value,
      json: looksJson(value),
    });
  });
  return entries;
}

export interface EntityLinks {
  task: string | null;
  dataset: string | null;
  datasetTitle: string;
  model: string | null;
  owner: string | null;
  project: string | null;
}

/** Links into the Runs list facets (and the dataset page when the run names a dataset slug). */
export function runEntityLinks(run: Run, slug: string | undefined): EntityLinks {
  if (!slug) return { task: null, dataset: null, datasetTitle: '', model: null, owner: null, project: null };
  const runs = projectPath(slug);
  const filtered = (param: string, value: string | null | undefined) =>
    value ? runs + '?' + new URLSearchParams([[param, value]]).toString() : null;
  const datasetName = run.dataset_name ?? '';
  const datasetValue =
    datasetName && run.dataset_version ? `${datasetName}␟${run.dataset_version}` : datasetName;
  let dataset: string | null = null;
  let datasetTitle = '';
  if (run.dataset_slug) {
    const params = new URLSearchParams([['tab', 'runs']]);
    if (run.dataset_version) params.set('v', String(run.dataset_version));
    dataset = projectPath(slug, `datasets/${encodeURIComponent(run.dataset_slug)}`) + '?' + params.toString();
    datasetTitle = `Open dataset ${datasetName} (runs on it)`;
  } else if (datasetValue) {
    dataset = filtered('dataset', datasetValue);
    datasetTitle = `Runs on dataset ${datasetName}`;
  }
  const taskName = run.task_name ?? '';
  const modelName = run.model_name ?? '';
  return {
    task: taskName ? filtered('task', taskName) : null,
    dataset,
    datasetTitle,
    model: modelName ? filtered('model', modelName) : null,
    owner: run.owner?.id ? filtered('owner', run.owner.id) : null,
    project: runs,
  };
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isLiveStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').toUpperCase();
  return s === 'RUNNING' || s === 'PENDING';
}

export interface HeroTiming {
  startedAt: string;
  endedAt: string;
  /** null = unknown; `ticking` = derive from now − startedAt each second. */
  runtimeMs: number | null;
  ticking: boolean;
}

export function heroTiming(run: Run, pass: PassSummary | null, now = Date.now()): HeroTiming {
  const startedAt = pass ? (pass.started_at ?? '') : (run.started_at ?? run.created_at ?? '');
  const endedAt = pass ? (pass.ended_at ?? '') : (run.ended_at ?? '');
  let runtimeMs: number | null = pass ? (pass.duration_ms ?? null) : (run.duration_ms ?? null);
  let ticking = false;
  const passRunning = !!pass && String(pass.status ?? '').toLowerCase() === 'running';
  if ((passRunning || runtimeMs == null) && startedAt && !endedAt) {
    const t = new Date(startedAt).getTime();
    if (!Number.isNaN(t)) {
      runtimeMs = now - t;
      ticking = isLiveStatus(run.status) || passRunning;
    }
  }
  return { startedAt, endedAt, runtimeMs, ticking };
}

export interface IngestWarning {
  expected: number;
  received: number;
  missing: number;
  rejectedCount: number;
  rejected: NonNullable<IngestIncomplete['rejected']>;
  moreCount: number;
}

export function ingestWarning(run: Run): IngestWarning | null {
  const flag = run.metadata?.ingest_incomplete;
  if (!flag || typeof flag !== 'object') return null;
  const expected = parseInt(String(flag.expected_items ?? 0), 10) || 0;
  const received = parseInt(String(flag.received_items ?? 0), 10) || 0;
  const missing = expected ? Math.max(expected - received, 0) : 0;
  const rejectedCount = parseInt(String(flag.rejected_events ?? 0), 10) || 0;
  const rejected = (Array.isArray(flag.rejected) ? flag.rejected : []).filter(
    (r) => r && typeof r === 'object',
  );
  if (missing <= 0 && rejectedCount <= 0) return null;
  return {
    expected,
    received,
    missing,
    rejectedCount,
    rejected,
    moreCount: Math.max(0, rejectedCount - rejected.length),
  };
}

export const SCORE_LOCK_COPY: Record<string, { lead: string; body: string }> = {
  SUBMITTED: {
    lead: 'Scores are locked.',
    body: 'This run is submitted for approval, so its scores cannot be edited or reset. A project manager can reject it to reopen score edits.',
  },
  APPROVED: {
    lead: 'Scores are locked.',
    body: 'This run is approved, so its scores cannot be edited or reset. A project manager can unapprove it to reopen score edits.',
  },
};

export const READ_ONLY_COPY = {
  lead: 'Read-only.',
  body: 'This run belongs to an archived project. You can view and export it, but scores, diagnoses and reviews cannot be changed until an admin unarchives the project.',
};

export function scoresLocked(run: Run): boolean {
  return !!SCORE_LOCK_COPY[String(run.status ?? '').toUpperCase()];
}

/** Model name without its provider prefix ("openai/gpt-5" → "gpt-5"), as the vanilla label does. */
export function shortModelName(name: string | null | undefined): string {
  const value = String(name ?? '');
  const slash = value.indexOf('/');
  return slash > 0 ? value.slice(slash + 1) : value;
}

/* ── round 3 P6: the chips of the run header (versioning, config, metadata) ── */

/** Longest key and value a header chip prints; the full `key: value` is in its title. */
export const CHIP_KEY_MAX = 20;
export const CHIP_VALUE_MAX = 30;

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

export interface HeaderChip {
  key: string;
  /** Clipped key (at most 20 characters). */
  label: string;
  /** Clipped value (at most 30 characters) or a one-token summary: `{ 3 keys }`, `[ 4 items ]`. */
  text: string;
  /** Full `key: value` for the tooltip (compact JSON for an object). */
  title: string;
  /** The raw value when it is an object or array (the expanded view opens it through JsonPreview). */
  raw?: unknown;
}

export interface HeaderChipGroup {
  label: 'Versioning' | 'Config' | 'Metadata';
  chips: HeaderChip[];
}

function parsedObject(value: unknown): unknown {
  if (value !== null && typeof value === 'object') return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        const parsed: unknown = JSON.parse(t);
        if (parsed !== null && typeof parsed === 'object') return parsed;
      } catch {
        /* a string that only looks like JSON stays text */
      }
    }
  }
  return undefined;
}

/** One chip for a key and value: scalars print clipped, objects and arrays a one-token summary. */
export function headerChip(key: string, value: unknown): HeaderChip {
  const obj = parsedObject(value);
  if (obj !== undefined) {
    const n = Array.isArray(obj) ? obj.length : Object.keys(obj as object).length;
    const text = Array.isArray(obj)
      ? `[ ${n} ${n === 1 ? 'item' : 'items'} ]`
      : `{ ${n} ${n === 1 ? 'key' : 'keys'} }`;
    return { key, label: clip(key, CHIP_KEY_MAX), text, title: `${key}: ${JSON.stringify(obj)}`, raw: obj };
  }
  const full = stringify(value);
  return { key, label: clip(key, CHIP_KEY_MAX), text: clip(full, CHIP_VALUE_MAX), title: `${key}: ${full}` };
}

/**
 * The header chip groups in priority order: Versioning (the run's versioning_details by key, then the git chip), Config,
 * Metadata. Empty groups are left out, so a run with none of them has no band 3.
 */
export function headerChips(run: Run): HeaderChipGroup[] {
  const versioning: HeaderChip[] = Object.entries(run.versioning_details ?? {})
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => headerChip(k, v));
  const git = [run.git_branch, run.git_commit].filter(Boolean).join(' • ');
  if (git) versioning.push(headerChip('git', git));
  const context = executionContextEntries(run);
  const config = context.filter((c) => c.group === 'Config').map((c) => headerChip(c.key, c.raw));
  const metadata = context.filter((c) => c.group === 'Metadata').map((c) => headerChip(c.key, c.raw));
  return (
    [
      { label: 'Versioning', chips: versioning },
      { label: 'Config', chips: config },
      { label: 'Metadata', chips: metadata },
    ] as HeaderChipGroup[]
  ).filter((g) => g.chips.length > 0);
}

/** "Stopped: reason" / "Failed: reason" for a run that ended without completing and has a reason; null otherwise. */
export function stopReasonLine(run: Run): { text: string; danger: boolean } | null {
  const reason = run.status_reason_label;
  const status = String(run.status ?? '').toUpperCase();
  if (!reason || !(status === 'STOPPED' || status === 'FAILED')) return null;
  return { text: `${status === 'FAILED' ? 'Failed' : 'Stopped'}: ${reason}`, danger: status === 'FAILED' };
}
