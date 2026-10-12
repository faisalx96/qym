/**
 * Everything derived once from {run, snapshot} (run.html processRun): metric
 * types, directions, default thresholds, metadata keys, metric meta keys,
 * auto-selected categories, and the pass-scoped rows for `?pass=N`.
 */
import {
  defaultMetricName,
  defaultPassThreshold,
  detectMetricType,
  isInternalMetaKey,
  metricDirection,
  metricTypeFromSpec,
  type MetricDirection,
  type MetricSpec,
  type MetricType,
} from '@/lib/metrics';
import type { Row, RunPayload } from '../types';
import { getMetadataCategoryValues, HIDDEN_METADATA_KEYS } from './rowMeta';
import { scopeRowToPass } from './passScope';

export interface RunModel {
  runId: string;
  metricNames: string[];
  metricSpecs: Record<string, MetricSpec>;
  metricTypes: Record<string, MetricType>;
  metricIsBoolean: Record<string, boolean>;
  metricDirections: Record<string, MetricDirection>;
  defaultThresholds: Record<string, number>;
  defaultMetric: string | null;
  samples: number;
  isRepeat: boolean;
  /** `?pass=N` when valid for this run, else null. */
  viewPass: number | null;
  /** Rows as the page reads them (scoped to the viewed pass when one is set). */
  rows: Row[];
  allMetadataKeys: string[];
  allMetricMetaKeys: string[];
  autoCategories: string[];
  passRevision: number;
}

export const MAX_CATEGORY_CARDINALITY = 30;

export function isRepeatRunPayload(run: RunPayload['run']): boolean {
  return (parseInt(String(run.samples ?? 1), 10) || 1) > 1 || !!run.metadata?.has_repeat_pass_context;
}

export function buildRunModel(payload: RunPayload, requestedPass: number | null): RunModel {
  const { run, snapshot } = payload;
  const metricNames = snapshot.metric_names ?? run.metric_names ?? [];
  const metricSpecs = snapshot.metric_specs ?? run.metric_specs ?? {};
  const samples = parseInt(String(run.samples ?? 1), 10) || 1;
  const isRepeat = isRepeatRunPayload(run);
  const viewPass = requestedPass && isRepeat && requestedPass <= samples ? requestedPass : null;
  const sourceRows = snapshot.rows ?? [];
  const rows = viewPass ? sourceRows.map((row) => scopeRowToPass(row, metricNames, viewPass)) : sourceRows;

  const metricTypes: Record<string, MetricType> = {};
  const metricIsBoolean: Record<string, boolean> = {};
  const metricDirections: Record<string, MetricDirection> = {};
  const defaultThresholds: Record<string, number> = {};
  metricNames.forEach((name, idx) => {
    const spec = metricSpecs[name];
    const passObservationRows = viewPass
      ? []
      : sourceRows.flatMap((row) => {
          const scores = row.pass_scores?.[name];
          return Array.isArray(scores) ? scores.map((score) => ({ metric_values: [score] })) : [];
        });
    const inferred = passObservationRows.length
      ? detectMetricType(passObservationRows, 0)
      : detectMetricType(rows, idx);
    const type = spec && spec.score_type !== 'legacy' ? metricTypeFromSpec(spec) : inferred;
    metricTypes[name] = type;
    metricIsBoolean[name] = type === 'boolean';
    metricDirections[name] = metricDirection(spec);
    defaultThresholds[name] = defaultPassThreshold(spec);
  });

  const metaKeys = new Set<string>();
  rows.forEach((row) => {
    const md = row.item_metadata;
    if (md && typeof md === 'object') {
      Object.keys(md).forEach((k) => {
        if (k !== 'task_started_at_ms' && k !== 'trace_stats') metaKeys.add(k);
      });
    }
  });
  const allMetadataKeys = Array.from(metaKeys).sort();

  const autoCategories: string[] = [];
  for (const key of allMetadataKeys) {
    if (HIDDEN_METADATA_KEYS.has(key)) continue;
    const unique = new Set<string>();
    for (const row of rows) {
      const v = row.item_metadata?.[key];
      if (v != null && v !== '')
        getMetadataCategoryValues(row.item_metadata, key).forEach((x) => unique.add(x));
    }
    if (unique.size === 0 || unique.size > MAX_CATEGORY_CARDINALITY) continue;
    if (autoCategories.length < 3) autoCategories.push(key);
  }

  const mmKeys = new Set<string>();
  const passMetaKeys = viewPass ? (snapshot.pass_metric_meta_keys ?? {}) : {};
  const keysByPass = snapshot.pass_metric_meta_keys_by_pass;
  const schemaKeys: string[][] = [
    ...Object.entries(snapshot.metric_meta_keys ?? {})
      .filter(([name]) => !passMetaKeys[name])
      .map(([, keys]) => keys),
    ...(viewPass && keysByPass ? [keysByPass[String(viewPass)] ?? []] : Object.values(passMetaKeys)),
  ];
  schemaKeys.forEach((keys) => (keys ?? []).forEach((k) => !isInternalMetaKey(k) && mmKeys.add(k)));
  rows.forEach((row) => {
    Object.values(row.metric_meta ?? {}).forEach((meta) => {
      if (meta && typeof meta === 'object')
        Object.keys(meta).forEach((k) => !isInternalMetaKey(k) && mmKeys.add(k));
    });
  });

  return {
    runId: run.run_id,
    metricNames,
    metricSpecs,
    metricTypes,
    metricIsBoolean,
    metricDirections,
    defaultThresholds,
    defaultMetric: defaultMetricName(metricNames, metricSpecs),
    samples,
    isRepeat,
    viewPass,
    rows,
    allMetadataKeys,
    allMetricMetaKeys: Array.from(mmKeys).sort(),
    autoCategories,
    passRevision: Number(run.metadata?.pass_revision ?? 0),
  };
}

/** The Display pass threshold applies to a scored metric with a declared direction. */
export function metricHasPassThreshold(
  model: Pick<RunModel, 'metricIsBoolean' | 'metricTypes' | 'metricDirections'>,
  metric: string | null,
): boolean {
  return (
    !!metric &&
    !model.metricIsBoolean[metric] &&
    model.metricTypes[metric] !== 'numeric' &&
    !!model.metricDirections[metric]
  );
}
