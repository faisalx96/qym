/**
 * The compare model: everything derived once from `GET /api/compare` (brief 05
 * §4 `RunData`) and the requested refs. Repeat runs are sliced into one
 * pseudo-run per pass (compare.html expandPassRefs / sliceRunToPass, here via
 * the run-detail `scopeRowToPass`). Pure and synchronous.
 */
import {
  defaultMetricName,
  defaultPassThreshold,
  detectMetricType,
  metricDirection,
  metricTypeFromSpec,
  type MetricDirection,
  type MetricSpec,
  type MetricType,
} from '@/lib/metrics';
import type { Row, Run, RunPayload } from '@/features/run-detail/types';
import { scopeRowToPass } from '@/features/run-detail/lib/passScope';
import { computeRunLabels, modelShortName, type RunLabel } from './labels';
import { expandRefs, makePassRef, passRefBase, passRefNumber } from './refs';

export interface ComparePayload {
  runs: RunPayload[];
  langfuse_host?: string;
  langfuse_project_id?: string;
  compare_alignment_status?: 'aligned' | 'unalignable' | string;
  unalignable_runs?: Array<{ run_name: string; issues: string[] }>;
  missing_runs?: Array<{ run_id: string }>;
}

export type PassRun = Run & {
  pass_number?: number;
  base_run_name?: string;
  compare_alignment_status?: string;
  compare_alignment_issues?: string[];
};

export interface CompareRun {
  /** Run id, or `<id>::pass<N>`. */
  ref: string;
  base: string;
  pass: number | null;
  run: PassRun;
  rows: Row[];
  /** compare_item_id -> row. */
  byItem: Map<string, Row>;
  metricIndex: Record<string, number>;
  label: string;
  title: string;
  /** 0-based position among the compared runs (palette index). */
  position: number;
  snapshot: RunPayload['snapshot'];
}

export interface CompareModel {
  runs: CompareRun[];
  /** Every compare item id, in first-seen order. */
  itemIds: string[];
  metrics: string[];
  specs: Record<string, MetricSpec>;
  types: Record<string, MetricType>;
  isBoolean: Record<string, boolean>;
  directions: Record<string, MetricDirection>;
  defaultThresholds: Record<string, number>;
  defaultMetric: string | null;
  metadataKeys: string[];
  alignment: { status: 'aligned' | 'unalignable'; runs: Array<{ run_name: string; issues: string[] }> };
  langfuseHost: string;
  langfuseProjectId: string;
  /** Distinct base runs (for labels and "remove run"). */
  bases: string[];
}

const META_SKIP = new Set(['task_started_at_ms', 'trace_stats']);

export function getRowCompareId(row: Row | null | undefined): string | null {
  return (row?.compare_item_id as string | undefined) || null;
}

/** compare.html sliceRunToPass for run + snapshot. */
export function slicePayloadToPass(base: RunPayload, ref: string, pass: number): RunPayload {
  const baseRun = base.run;
  const name = baseRun.run_name || baseRun.run_id || 'run';
  const metricNames = base.snapshot.metric_names ?? baseRun.metric_names ?? [];
  const rows = (base.snapshot.rows ?? []).map((row) => scopeRowToPass(row, metricNames, pass));
  const failed = rows.filter((r) => r.status === 'error').length;
  const completed = rows.filter((r) => r.status === 'completed').length;
  const run: PassRun = {
    ...baseRun,
    file_path: ref,
    run_name: `${name} · pass ${pass}`,
    base_run_name: name,
    pass_number: pass,
    samples: 1,
    error_count: failed,
    execution_error_count: failed,
  };
  return {
    run,
    snapshot: {
      ...base.snapshot,
      rows,
      stats: { ...base.snapshot.stats, total: rows.length, completed, failed },
    },
  };
}

export function buildCompareModel(payload: ComparePayload, requested: string[]): CompareModel {
  const loaded = payload.runs ?? [];
  const refs = expandRefs(requested, loaded.map((r) => r.run));
  const byBase = new Map(loaded.map((r) => [r.run.file_path || r.run.run_id, r]));

  const picked: Array<{ ref: string; base: string; pass: number | null; data: RunPayload }> = [];
  for (const ref of refs) {
    const base = passRefBase(ref);
    const data = byBase.get(base);
    if (!data) continue;
    const pass = passRefNumber(ref);
    picked.push({ ref, base, pass, data: pass ? slicePayloadToPass(data, ref, pass) : data });
  }

  const labelInputs: Array<{ base: string; name: string; model: string; started: string }> = [];
  const seen = new Set<string>();
  for (const p of picked) {
    if (seen.has(p.base)) continue;
    seen.add(p.base);
    const info = byBase.get(p.base)!.run;
    labelInputs.push({
      base: p.base,
      name: String(info.run_name || info.run_id || p.base).trim(),
      model: modelShortName(info.model_name || (info.config?.model as string) || ''),
      started: String(info.started_at || info.created_at || ''),
    });
  }
  const labels: Record<string, RunLabel> = computeRunLabels(labelInputs);

  const itemIdSet = new Set<string>();
  const metricLists: string[][] = [];
  const defaultSpecs: Record<string, MetricSpec> = {};
  const runs: CompareRun[] = picked.map((p, position) => {
    const { run, snapshot } = p.data;
    const rows = snapshot.rows ?? [];
    const byItem = new Map<string, Row>();
    for (const row of rows) {
      const id = getRowCompareId(row);
      if (id) {
        byItem.set(id, row);
        itemIdSet.add(id);
      }
    }
    const names = snapshot.metric_names ?? run.metric_names ?? [];
    metricLists.push(names);
    const specs = snapshot.metric_specs ?? run.metric_specs ?? {};
    for (const [name, spec] of Object.entries(specs)) if (!(name in defaultSpecs)) defaultSpecs[name] = spec;
    const metricIndex: Record<string, number> = {};
    names.forEach((n, i) => (metricIndex[n] = i));
    const lab = labels[p.base] ?? { label: p.base, title: p.base };
    return {
      ref: p.ref,
      base: p.base,
      pass: p.pass,
      run: run as PassRun,
      rows,
      byItem,
      metricIndex,
      label: p.pass ? `${lab.label} · pass ${p.pass}` : lab.label,
      title: p.pass ? `${lab.title} · pass ${p.pass}` : lab.title,
      position,
      snapshot,
    };
  });

  const metrics = mergeMetricNames(metricLists);
  const specs: Record<string, MetricSpec> = {};
  const types: Record<string, MetricType> = {};
  const isBoolean: Record<string, boolean> = {};
  const directions: Record<string, MetricDirection> = {};
  const defaultThresholds: Record<string, number> = {};
  for (const metric of metrics) {
    const declared = new Set<MetricDirection>();
    let conflict = false;
    const rowsForType: Array<{ metric_values: unknown[] }> = [];
    for (const run of runs) {
      const spec = run.snapshot.metric_specs?.[metric] ?? run.run.metric_specs?.[metric];
      const dir = metricDirection(spec);
      if (dir) declared.add(dir);
      if (spec && spec.score_type !== 'legacy') {
        if (specs[metric] && JSON.stringify(specs[metric]) !== JSON.stringify(spec)) conflict = true;
        else if (!specs[metric]) specs[metric] = spec;
      }
      const idx = run.metricIndex[metric];
      if (idx !== undefined) for (const row of run.rows) rowsForType.push({ metric_values: [row.metric_values?.[idx]] });
    }
    const inferred = detectMetricType(rowsForType, 0);
    const type: MetricType = conflict ? 'numeric' : specs[metric] ? metricTypeFromSpec(specs[metric]) : inferred;
    types[metric] = type;
    isBoolean[metric] = type === 'boolean';
    directions[metric] = declared.size === 1 ? (Array.from(declared)[0] ?? null) : null;
    defaultThresholds[metric] = defaultPassThreshold(specs[metric], directions[metric]);
  }

  const metaKeys = new Set<string>();
  for (const run of runs)
    for (const row of run.rows) {
      const md = row.item_metadata;
      if (md && typeof md === 'object') for (const k of Object.keys(md)) if (!META_SKIP.has(k)) metaKeys.add(k);
    }

  const unalignable = runs
    .filter((r) => (r.run.compare_alignment_status ?? 'aligned') !== 'aligned')
    .map((r) => ({ run_name: r.run.base_run_name || r.run.run_name || 'Unnamed run', issues: r.run.compare_alignment_issues ?? [] }));
  const dedupedUnalignable = unalignable.filter((u, i) => unalignable.findIndex((o) => o.run_name === u.run_name) === i);

  const first = loaded[0]?.run;
  return {
    runs,
    itemIds: Array.from(itemIdSet),
    metrics,
    specs,
    types,
    isBoolean,
    directions,
    defaultThresholds,
    defaultMetric: defaultMetricName(metrics, defaultSpecs),
    metadataKeys: Array.from(metaKeys).sort(),
    alignment: { status: dedupedUnalignable.length ? 'unalignable' : 'aligned', runs: dedupedUnalignable },
    langfuseHost: payload.langfuse_host || first?.langfuse_host || '',
    langfuseProjectId: payload.langfuse_project_id || first?.langfuse_project_id || '',
    bases: Array.from(new Set(runs.map((r) => r.base))),
  };
}

export function mergeMetricNames(lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const name of list) if (!out.includes(name)) out.push(name);
  return out;
}

export { makePassRef };
