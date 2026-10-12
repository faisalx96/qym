/** Wire types of the SDK local viewer API (packages/sdk/qym/server/app.py). */

export type RowStatus = 'pending' | 'in_progress' | 'completed' | 'error';

/** Metric cells are strings in both producers: "0.83", "1", "pending", "n/a", "computing...". */
export interface Row {
  index: number;
  status: RowStatus;
  input: string;
  input_full: string;
  output: string;
  output_full: string;
  expected: string;
  expected_full: string;
  metric_values: Array<string | number>;
  metric_meta: Record<string, Record<string, string>>;
  time: string;
  /** null while running; historical files may carry floats. */
  latency_ms: number | null;
  trace_id: string | null;
  trace_url: string | null;
  item_id?: string;
}

export interface Stats {
  total: number;
  completed: number;
  in_progress: number;
  failed: number;
  pending: number;
  /** 0-100 */
  success_rate: number;
}

export interface Snapshot {
  rows: Row[];
  stats: Stats;
  metric_names: string[];
  last_updated?: string;
}

/** `GET api/run` (live; `{}` until the evaluation registers) and `run` of `GET api/runs/<file>`. */
export interface RunInfo {
  dataset_name?: string;
  run_name?: string;
  model?: string;
  status?: 'RUNNING' | 'COMPLETED' | 'STOPPED';
  started_at?: string | null;
  ended_at?: string | null;
  metric_names?: string[];
  config?: { max_concurrency?: number; timeout?: number; [k: string]: unknown };
  /** historical only: absolute path of the results file (needed for score edits) */
  file_path?: string;
}

export interface RunFile {
  run: RunInfo;
  snapshot: Snapshot;
}
