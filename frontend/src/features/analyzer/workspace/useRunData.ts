/** Loads a run for the analyzer: header, samples, compact rows and (lazily) item bodies. */
import { useMemo } from 'react';
import {
  useItemDetails,
  useRunCompact,
  useRunPasses,
  useRunSummary,
  type CompactRow,
  type RunPasses,
  type RunSummary,
} from '@/api/analysis';
import { buildAnalyzerRows, type AnalyzerRow } from '../model/targets';

const DETAIL_KEYS = [
  'input',
  'input_full',
  'expected',
  'expected_full',
  'output',
  'output_full',
  'metric_meta',
  'pass_metric_meta',
  'pass_attempts',
] as const;

export const SAMPLE_ROWS = 20;

export interface RunData {
  run: RunSummary['run'] | undefined;
  repeat: boolean;
  passes: RunPasses['passes'];
  /** A repeat run with no valid `pass`: the sample picker shows instead of the workspace. */
  needsPass: boolean;
  /** Effective pass number (null for single-sample runs). */
  pass: number | null;
  metricNames: string[];
  metricSpecs: NonNullable<ReturnType<typeof useRunCompact>['data']>['snapshot']['metric_specs'];
  rows: AnalyzerRow[];
  passRevision: number | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  bodiesLoading: boolean;
}

export function useRunData(runId: string, passParam: number | null, loadBodies: boolean): RunData {
  const summary = useRunSummary(runId);
  const run = summary.data?.run;
  const repeat = Number(run?.samples ?? 1) > 1 || Boolean(run?.metadata?.has_repeat_pass_context);
  const passes = useRunPasses(runId, repeat);
  const validPass =
    repeat && passParam != null && (passes.data ? passes.data.passes.some((p) => p.pass_number === passParam) : true);
  const pass = repeat && validPass ? passParam : null;
  const needsPass = repeat && pass == null && !passes.isPending;
  const compact = useRunCompact(runId, pass, Boolean(run) && !needsPass && !(repeat && passes.isPending));
  const snapshot = compact.data?.snapshot;
  const sampleIds = useMemo(
    () => (snapshot?.rows ?? []).slice(0, SAMPLE_ROWS).map((r) => String(r.item_id ?? r.index)),
    [snapshot],
  );
  const details = useItemDetails(runId, sampleIds, loadBodies);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    const byId = new Map((details.data?.rows ?? []).map((r) => [String(r.item_id ?? r.index), r]));
    const merged: CompactRow[] = snapshot.rows.map((row, index) => {
      const full = index < SAMPLE_ROWS ? byId.get(String(row.item_id ?? row.index)) : undefined;
      if (!full) return row;
      const copy: CompactRow = { ...row };
      for (const key of DETAIL_KEYS) if (full[key] !== undefined) (copy as Record<string, unknown>)[key] = full[key];
      return copy;
    });
    return buildAnalyzerRows({
      rows: merged,
      metricNames: snapshot.metric_names,
      metricSpecs: snapshot.metric_specs,
      passNumber: pass,
    });
  }, [snapshot, details.data, pass]);

  const firstError = summary.error ?? passes.error ?? compact.error;
  return {
    run,
    repeat,
    passes: passes.data?.passes ?? [],
    needsPass,
    pass,
    metricNames: snapshot?.metric_names ?? run?.metric_names ?? [],
    metricSpecs: snapshot?.metric_specs ?? run?.metric_specs ?? {},
    rows,
    passRevision: typeof run?.metadata?.pass_revision === 'number' ? run.metadata.pass_revision : undefined,
    isPending: summary.isPending || (repeat && passes.isPending) || (!needsPass && Boolean(run) && compact.isPending),
    isError: Boolean(firstError),
    error: firstError,
    refetch: () => {
      void summary.refetch();
      void passes.refetch();
      void compact.refetch();
    },
    bodiesLoading: loadBodies && details.isPending,
  };
}
