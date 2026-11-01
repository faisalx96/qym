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
import {
  computeRunLabels,
  disambiguateRunNames,
  modelShortName,
  runShortName,
  type RunLabel,
} from './labels';
import { SKIPPED_METADATA } from './skipMetadata';
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
  /** Passes of the run this slice comes from; a '· pass N' suffix shows only when it is more than 1 (C162). */
  pass_count?: number;
  /** Every compared column is a pass of this one run: the pass goes by 'Pass N' and the title names the run (C215). */
  pass_only?: boolean;
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
  /**
   * C058: the runs evaluated different tasks or datasets (by name), so items are not paired. One entry per base run
   * (its name, task and dataset); null when the runs share a task and a dataset.
   */
  unpaired: Array<{ name: string; task: string; dataset: string }> | null;
  langfuseHost: string;
  langfuseProjectId: string;
  /** Distinct base runs (for labels and "remove run"). */
  bases: string[];
}

export function getRowCompareId(row: Row | null | undefined): string | null {
  return (row?.compare_item_id as string | undefined) || null;
}

/** compare.html sliceRunToPass for run + snapshot. */
export function slicePayloadToPass(base: RunPayload, ref: string, pass: number): RunPayload {
  const baseRun = base.run;
  const name = baseRun.run_name || baseRun.run_id || 'run';
  const passCount = Number(baseRun.samples) || 1;
  const metricNames = base.snapshot.metric_names ?? baseRun.metric_names ?? [];
  const rows = (base.snapshot.rows ?? []).map((row) => scopeRowToPass(row, metricNames, pass));
  const failed = rows.filter((r) => r.status === 'error').length;
  const completed = rows.filter((r) => r.status === 'completed').length;
  const run: PassRun = {
    ...baseRun,
    file_path: ref,
    run_name: passCount > 1 ? `${name} · pass ${pass}` : name,
    base_run_name: name,
    pass_number: pass,
    pass_count: passCount,
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
  const refs = expandRefs(
    requested,
    loaded.map((r) => r.run),
  );
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
    const name = String(byBase.get(p.base)!.run.run_name || byBase.get(p.base)!.run.run_id || p.base).trim();
    const passCount = Number(byBase.get(p.base)!.run.samples) || 1;
    const suffix = p.pass && passCount > 1 ? ` · pass ${p.pass}` : '';
    return {
      ref: p.ref,
      base: p.base,
      pass: p.pass,
      run: run as PassRun,
      rows,
      byItem,
      metricIndex,
      label: `${name}${suffix}`,
      title: `${lab.title}${suffix}`,
      position,
      snapshot,
    };
  });

  // D2: two runs that share a name show their start time as well, everywhere the name is shown.
  const shown = disambiguateRunNames(
    runs.map((r) => ({
      base: r.base,
      name: runShortName({ label: r.label, run: r.run }).replace(/ · pass \d+$/, ''),
      started: String(r.run.started_at || r.run.created_at || ''),
    })),
  );
  runs.forEach((r, i) => {
    const base = runShortName({ label: r.label, run: r.run }).replace(/ · pass \d+$/, '');
    if (shown[i] !== base) {
      r.run = { ...r.run, run_name: shown[i] } as PassRun;
      r.label = r.label.replace(base, shown[i]!);
    }
  });

  // C215: the passes of one repeat run, alone, go by 'Pass 1' to 'Pass N'
  if (new Set(runs.map((r) => r.base)).size === 1 && runs.length > 1)
    runs.forEach((r) => {
      if (!r.pass) return;
      r.run = { ...r.run, pass_only: true } as PassRun;
      r.label = `Pass ${r.pass}`;
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
      if (idx !== undefined)
        for (const row of run.rows) rowsForType.push({ metric_values: [row.metric_values?.[idx]] });
    }
    const inferred = detectMetricType(rowsForType, 0);
    const type: MetricType = conflict
      ? 'numeric'
      : specs[metric]
        ? metricTypeFromSpec(specs[metric])
        : inferred;
    types[metric] = type;
    isBoolean[metric] = type === 'boolean';
    directions[metric] = declared.size === 1 ? (Array.from(declared)[0] ?? null) : null;
    defaultThresholds[metric] = defaultPassThreshold(specs[metric], directions[metric]);
  }

  const metaKeys = new Set<string>();
  for (const run of runs)
    for (const row of run.rows) {
      const md = row.item_metadata;
      if (md && typeof md === 'object')
        for (const k of Object.keys(md)) if (!SKIPPED_METADATA.has(k)) metaKeys.add(k);
    }

  const unalignable = runs
    .filter((r) => (r.run.compare_alignment_status ?? 'aligned') !== 'aligned')
    .map((r) => ({
      run_name: r.run.base_run_name || r.run.run_name || 'Unnamed run',
      issues: r.run.compare_alignment_issues ?? [],
    }));
  const dedupedUnalignable = unalignable.filter(
    (u, i) => unalignable.findIndex((o) => o.run_name === u.run_name) === i,
  );

  // C058: different tasks, or different dataset names on single-dataset runs, are not paired item by item
  const baseRuns = Array.from(new Set(runs.map((r) => r.base))).map((b) => byBase.get(b)!.run);
  const tasks = new Set(baseRuns.map((r) => String(r.task_name ?? '').trim()).filter(Boolean));
  const singleDataset = baseRuns.every((r) => (r.dataset_count ?? 1) <= 1);
  const datasets = new Set(baseRuns.map((r) => String(r.dataset_name ?? '').trim()).filter(Boolean));
  const unpaired =
    baseRuns.length > 1 && (tasks.size > 1 || (singleDataset && datasets.size > 1))
      ? baseRuns.map((r) => ({
          name: String(r.run_name || r.run_id),
          task: String(r.task_name ?? ''),
          dataset: String(r.dataset_name ?? ''),
        }))
      : null;

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
    // C155: open on a metric every compared run has, so the first view is never empty for some runs
    defaultMetric: defaultMetricName(
      metrics,
      defaultSpecs,
      metricLists.length ? metrics.filter((m) => metricLists.every((l) => l.includes(m))) : undefined,
    ),
    metadataKeys: Array.from(metaKeys).sort(),
    alignment: { status: dedupedUnalignable.length ? 'unalignable' : 'aligned', runs: dedupedUnalignable },
    unpaired,
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
