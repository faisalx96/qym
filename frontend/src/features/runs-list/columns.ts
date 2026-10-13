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
  align?: 'start' | 'end';
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
  base('status', 'Status', 200, 'status'),
  { ...base('signals', 'Signals', 84), visKey: null },
  base('task', 'Task', 100, 'task'),
  base('model', 'Model', 150, 'model'),
  base('dataset', 'Dataset', 120, 'dataset'),
  base('owner', 'Owner', 120, 'owner'),
  base('time', 'Date', 128, 'time'),
  base('analysis', 'Analysis', 92),
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
    align: 'end',
    visKey: 'latency',
  },
  {
    id: 'median-latency',
    label: '⚡ Median latency',
    group: 'system',
    sortKey: 'median-latency',
    width: 120,
    align: 'end',
    visKey: 'median-latency',
  },
];
export const DURATION_COLUMN: ColumnDef = {
  ...base('duration', 'Duration', 96, 'duration'),
  group: 'system',
  align: 'end',
};

export const TRACE_COLUMNS: ColumnDef[] = [
  {
    id: 'trace-avg_tokens',
    label: '⚡ Avg tokens',
    group: 'trace',
    sortKey: 'trace-avg_tokens',
    width: 110,
    align: 'end',
    visKey: 'avg_tokens',
  },
  {
    id: 'trace-avg_llm_calls',
    label: '⚡ LLM calls',
    group: 'trace',
    sortKey: 'trace-avg_llm_calls',
    width: 106,
    align: 'end',
    visKey: 'avg_llm_calls',
  },
  {
    id: 'trace-avg_tool_calls',
    label: '⚡ Tool calls',
    group: 'trace',
    sortKey: 'trace-avg_tool_calls',
    width: 106,
    align: 'end',
    visKey: 'avg_tool_calls',
  },
  {
    id: 'trace-tool_success_rate',
    label: '⚡ Tool success',
    group: 'trace',
    sortKey: 'trace-tool_success_rate',
    width: 116,
    align: 'end',
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
    align: 'end',
    visKey: 'group_pass_at_k',
  },
  {
    id: 'group-consistency',
    label: 'Consistency',
    group: 'group',
    width: 100,
    align: 'end',
    visKey: 'group_consistency',
  },
  {
    id: 'group-reliability',
    label: 'Reliability',
    group: 'group',
    width: 100,
    align: 'end',
    visKey: 'group_reliability',
  },
];

export const ACTIONS_COLUMN: ColumnDef = {
  id: 'actions',
  label: 'Actions',
  group: 'run',
  width: 104,
  visKey: null,
};

export function metricColumn(name: string): ColumnDef {
  return {
    id: `metric-${name}`,
    label: name.replace(/_/g, ' '),
    group: 'metrics',
    sortKey: `metric-${name}`,
    width: 150,
    visKey: name,
  };
}

export interface ColumnSet {
  all: ColumnDef[];
  visible: ColumnDef[];
}

/** `visible === null` = nothing saved yet: every column except trace stats without data. */
export function buildColumns(
  metrics: string[],
  traceWithData: Set<string>,
  visible: Set<string> | null,
): ColumnSet {
  const all: ColumnDef[] = [
    ...BASE_COLUMNS,
    ...metrics.map(metricColumn),
    ...TRACE_COLUMNS,
    ...SYSTEM_COLUMNS,
    DURATION_COLUMN,
    ACTIONS_COLUMN,
  ];
  // Table order: Run, Status, Signals, first two scores, Date, the other context columns, more scores, system, trace, duration, actions.
  // The first two metric columns follow Status so a score is visible on first paint.
  const metricCols = metrics.map(metricColumn);
  const byId = (id: string) => BASE_COLUMNS.find((c) => c.id === id)!;
  const ordered = [
    byId('run'),
    byId('status'),
    byId('signals'),
    ...metricCols.slice(0, 2),
    byId('time'),
    ...BASE_COLUMNS.filter((c) => !['run', 'status', 'signals', 'time', 'duration'].includes(c.id)),
    ...metricCols.slice(2),
    ...SYSTEM_COLUMNS,
    ...TRACE_COLUMNS,
    DURATION_COLUMN,
    ACTIONS_COLUMN,
  ];
  const show = (c: ColumnDef) => {
    if (c.visKey === null) return true;
    if (visible) return visible.has(c.visKey);
    if (c.group === 'trace') return traceWithData.has(c.visKey);
    return true;
  };
  return { all, visible: ordered.filter(show) };
}

/** A sort key whose column is hidden falls back to the default order (dashboard.js 4373–4396). */
export function sortColumnVisible(sortKey: string, visible: ColumnDef[]): boolean {
  const field = sortKey.replace(/-(asc|desc)$/, '');
  if (!/^(metric-|trace-|latency|median-latency|duration)/.test(field)) return true;
  return visible.some((c) => c.sortKey === field);
}
