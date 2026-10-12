/** Synthetic compare payloads for unit tests (no network). */
import type { Row, RunPayload } from '@/features/run-detail/types';
import type { ComparePayload } from '../model';

export interface FixtureRun {
  id: string;
  name?: string;
  model?: string;
  samples?: number;
  /** itemId -> per metric score (single pass) or per-pass scores (repeat). */
  scores: Record<string, Record<string, number | number[] | 'error'>>;
  metaByItem?: Record<string, Record<string, unknown>>;
  taskErrors?: string[];
  specs?: Record<string, Record<string, unknown>>;
  config?: Record<string, unknown>;
}

const DEFAULT_SPECS = {
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, primary: true, schema_version: 2 },
};

export function makeRun(f: FixtureRun, metrics = ['correct', 'quality']): RunPayload {
  const samples = f.samples ?? 1;
  const specs = f.specs ?? DEFAULT_SPECS;
  const itemIds = Object.keys(f.scores);
  const rows: Row[] = itemIds.map((itemId, index) => {
    const cells = f.scores[itemId] ?? {};
    const failed = (f.taskErrors ?? []).includes(itemId);
    const meta: Record<string, unknown> = {};
    const row: Row = {
      index,
      item_id: itemId,
      compare_item_id: itemId,
      status: failed ? 'error' : 'completed',
      error: failed ? 'TimeoutError' : '',
      latency_ms: 1000 + index * 10,
      metric_values: metrics.map((m) => {
        const v = cells[m];
        if (v === 'error' || v === undefined) return '';
        if (Array.isArray(v)) return v.reduce((s, x) => s + x, 0) / v.length;
        return v;
      }),
      metric_meta: {},
      item_metadata: { ...(f.metaByItem?.[itemId] ?? {}) },
      input_preview: `input ${itemId}`,
      __details_loaded: false,
      retry_count: 0,
    };
    metrics.forEach((m) => {
      const v = cells[m];
      if (v === 'error') row.metric_meta![m] = { status: 'error', error: 'JudgeError' };
    });
    if (samples > 1) {
      row.pass_scores = {};
      row.pass_metric_meta = {};
      metrics.forEach((m) => {
        const v = cells[m];
        const arr = Array.isArray(v) ? v : new Array<number>(samples).fill(typeof v === 'number' ? v : 0);
        row.pass_scores![m] = arr;
        row.pass_metric_meta![m] = arr.map(() => ({}));
      });
      row.pass_attempts = new Array(samples).fill(null).map((_, i) => ({
        pass_number: i + 1,
        status: 'completed',
        latency_ms: 900 + i,
        __has_output: true,
      }));
    }
    void meta;
    return row;
  });
  return {
    run: {
      run_id: f.id,
      file_path: f.id,
      run_name: f.name ?? f.id,
      model_name: f.model ?? 'model-a',
      metric_names: metrics,
      metric_specs: specs,
      status: 'COMPLETED',
      samples,
      started_at: '2026-10-01T12:00:00Z',
      config: { samples, ...(f.config ?? {}) },
      metadata: {},
    } as RunPayload['run'],
    snapshot: { rows, metric_names: metrics, metric_specs: specs, detail_mode: 'lazy' },
  };
}

export function makePayload(runs: FixtureRun[]): ComparePayload {
  return {
    runs: runs.map((r) => makeRun(r)),
    langfuse_host: '',
    langfuse_project_id: '',
    compare_alignment_status: 'aligned',
    unalignable_runs: [],
    missing_runs: [],
  };
}
