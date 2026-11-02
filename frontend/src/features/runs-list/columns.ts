/** Column catalogue of the runs table; visibility uses the legacy `qym_visible_metrics` keys. */
import { baseColumnKey } from './selection';

export type ColumnGroup = 'run' | 'metrics' | 'system' | 'trace' | 'group';

export interface ColumnDef {
  id: string;
  label: string;
  group: ColumnGroup;
  /** Server/URL sort key (`metric-<name>`, `trace-<key>`, `time`, …). */
  sortKey?: string;
  width: number;
  align?: 'start' | 'center' | 'end';
  /** Key stored in the visible-columns set (null = always shown). */
  visKey: string | null;
}

const base = (id: string, label: string, width: number, sortKey?: string): ColumnDef => ({
  id,
  label,
  group: 'run',
  sortKey,
  width,
  visKey: baseColumnKey(id),
});

export const BASE_COLUMNS: ColumnDef[] = [
  { ...base('run', 'Run', 260, 'run') },
  // the signals (errors, retries, incomplete data) sit in the Status cell, after the status (C028)
  base('status', 'Status', 176, 'status'),
  // 86 (was 90): the Dataset column grew to 120 for the union count tag (QC-U33) and Date, the default sort, must stay
  // fully on screen before the Actions column at 1280, where Owner is hidden (Date overhung by 4 px).
  base('task', 'Task', 86, 'task'),
  base('model', 'Model', 132, 'model'),
  base('dataset', 'Dataset', 120, 'dataset'),
  base('owner', 'Owner', 120, 'owner'),
  base('time', 'Date', 120, 'time'),
  base('analysis', 'Analysis', 100),
  base('experiment', 'Experiment', 110),
  base('version', 'Version', 150, 'version'),
];

export const SYSTEM_COLUMNS: ColumnDef[] = [
  {
    id: 'latency',
    label: '⚡ Avg latency',
    group: 'system',
    sortKey: 'latency',
    width: 110,
    align: 'center',
    visKey: 'latency',
  },
  {
    id: 'median-latency',
    label: '⚡ Median latency',
    group: 'system',
    sortKey: 'median-latency',
    width: 120,
    align: 'center',
    visKey: 'median-latency',
  },
];
export const DURATION_COLUMN: ColumnDef = {
  ...base('duration', 'Duration', 96, 'duration'),
  group: 'system',
  align: 'center',
};

export const TRACE_COLUMNS: ColumnDef[] = [
  {
    id: 'trace-avg_tokens',
    label: '⚡ Avg tokens',
    group: 'trace',
    sortKey: 'trace-avg_tokens',
    width: 110,
    align: 'center',
    visKey: 'avg_tokens',
  },
  {
    id: 'trace-avg_llm_calls',
    label: '⚡ LLM calls',
    group: 'trace',
    sortKey: 'trace-avg_llm_calls',
    width: 106,
    align: 'center',
    visKey: 'avg_llm_calls',
  },
  {
    id: 'trace-avg_tool_calls',
    label: '⚡ Tool calls',
    group: 'trace',
    sortKey: 'trace-avg_tool_calls',
    width: 106,
    align: 'center',
    visKey: 'avg_tool_calls',
  },
  {
    id: 'trace-tool_success_rate',
    label: '⚡ Tool success',
    group: 'trace',
    sortKey: 'trace-tool_success_rate',
    width: 116,
    align: 'center',
    visKey: 'tool_success_rate',
  },
];

/** Charts only: the repeat-run group stats, toggled from the Columns menu. */
export const GROUP_DISPLAY_COLUMNS: ColumnDef[] = [
  {
    id: 'group-pass-at-k',
    label: 'Pass@K',
    group: 'group',
    width: 100,
    align: 'center',
    visKey: 'group_pass_at_k',
  },
  {
    id: 'group-consistency',
    label: 'Consistency',
    group: 'group',
    width: 100,
    align: 'center',
    visKey: 'group_consistency',
  },
  {
    id: 'group-reliability',
    label: 'Reliability',
    group: 'group',
    width: 100,
    align: 'center',
    visKey: 'group_reliability',
  },
];

export const ACTIONS_COLUMN: ColumnDef = {
  id: 'actions',
  label: 'Actions',
  group: 'run',
  // one 20px row menu handle and the cell padding (owner decision, Nov 1: every row action sits in that menu)
  width: 44,
  align: 'end',
  visKey: null,
};

export function metricColumn(name: string): ColumnDef {
  return {
    id: `metric-${name}`,
    label: name.replace(/_/g, ' '),
    group: 'metrics',
    sortKey: `metric-${name}`,
    // a score is a number (no bar): centred under its header like every scalar column of the runs table
    width: 120,
    align: 'center',
    visKey: name,
  };
}

export interface ColumnSet {
  all: ColumnDef[];
  /** Every column in the default table order (hidden ones included). */
  ordered: ColumnDef[];
  visible: ColumnDef[];
}

export interface ColumnOptions {
  /** The metric the SDK declares as primary (`metric_specs[m].primary`), if any. */
  mainMetric?: string | null;
  /** Context columns that have a value in the filtered scope; an empty one is hidden by default (C223). */
  withData?: { experiment: boolean; version: boolean };
}

/** `visible === null` = nothing saved yet: every column except trace stats, Experiment and Version without data. */
export function buildColumns(
  metrics: string[],
  traceWithData: Set<string>,
  visible: Set<string> | null,
  /** Column ids the user hid (the table's own layout); wins over `visible`. */
  hidden?: Set<string> | null,
  options: ColumnOptions = {},
): ColumnSet {
  const all: ColumnDef[] = [
    ...BASE_COLUMNS,
    ...metrics.map(metricColumn),
    ...TRACE_COLUMNS,
    ...SYSTEM_COLUMNS,
    DURATION_COLUMN,
    ACTIONS_COLUMN,
  ];
  const byId = (id: string) => BASE_COLUMNS.find((c) => c.id === id)!;
  const show = (c: ColumnDef) => {
    if (c.visKey === null) return true;
    if (hidden) return !hidden.has(c.id);
    if (visible) return visible.has(c.visKey);
    if (c.group === 'trace') return traceWithData.has(c.visKey);
    if (c.id === 'experiment' && options.withData) return options.withData.experiment;
    if (c.id === 'version' && options.withData) return options.withData.version;
    return true;
  };
  const main = options.mainMetric && metrics.includes(options.mainMetric) ? options.mainMetric : null;
  const metricCols = (main ? [main, ...metrics.filter((m) => m !== main)] : metrics).map(metricColumn);
  // C028: the scores come right after Run and Status when the SDK declares a main metric, or when 3 or fewer scores
  // are shown; then the date and what a run is (model, dataset, owner, task).
  const scoresFirst = Boolean(main) || metricCols.filter(show).length <= 3;
  const tail = [...SYSTEM_COLUMNS, ...TRACE_COLUMNS, DURATION_COLUMN, ACTIONS_COLUMN];
  let ordered: ColumnDef[];
  if (scoresFirst) {
    const lead = ['run', 'status'];
    const context = ['time', 'model', 'dataset', 'owner', 'task'];
    ordered = [
      ...lead.map(byId),
      ...metricCols,
      ...context.map(byId),
      ...BASE_COLUMNS.filter((c) => ![...lead, ...context].includes(c.id)),
      ...tail,
    ];
  } else {
    // Legacy order for what a run is (task, model, dataset) and the Analyze action, then the first score and the
    // date, so all of them are on screen at 1440 next to the frozen Run and Status; the other context columns follow.
    const front = ['run', 'status', 'task', 'model', 'dataset', 'time', 'analysis'];
    ordered = [
      ...front.map(byId),
      ...metricCols.slice(0, 1),
      ...BASE_COLUMNS.filter((c) => !front.includes(c.id)),
      ...metricCols.slice(1),
      ...tail,
    ];
  }
  return { all, ordered, visible: ordered.filter(show) };
}

/** A sort key whose column is hidden falls back to the default order (dashboard.js 4373–4396). */
export function sortColumnVisible(sortKey: string, visible: ColumnDef[]): boolean {
  const field = sortKey.replace(/-(asc|desc)$/, '');
  if (!/^(metric-|trace-|latency|median-latency|duration)/.test(field)) return true;
  return visible.some((c) => c.sortKey === field);
}
