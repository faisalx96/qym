import type { Row, RowStatus } from '../types';
import { rowDatasetKey } from './datasets';
import { metricCell } from './metric-cell';

export type StatusFilter = 'all' | RowStatus;
export type SortKey = 'index' | 'status' | 'latency' | `metric:${number}`;
export type SortDir = 'asc' | 'desc';

export interface ViewState {
  q: string;
  status: StatusFilter;
  sort: SortKey;
  dir: SortDir;
  /** Union runs: the source dataset (`name@version`) the rows are narrowed to; '' = all. */
  dataset?: string;
}

export const DEFAULT_VIEW: ViewState = { q: '', status: 'all', sort: 'index', dir: 'asc' };
export const STATUS_FILTERS: StatusFilter[] = ['all', 'completed', 'in_progress', 'error', 'pending'];

const STATUS_RANK: Record<RowStatus, number> = { error: 0, pending: 1, in_progress: 2, completed: 3 };

export function filterRows(rows: Row[], view: Pick<ViewState, 'q' | 'status'> & { dataset?: string }): Row[] {
  const q = view.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (view.status !== 'all' && row.status !== view.status) return false;
    if (view.dataset && rowDatasetKey(row) !== view.dataset) return false;
    if (!q) return true;
    return [row.input_full, row.output_full, row.expected_full].some((t) =>
      String(t ?? '')
        .toLowerCase()
        .includes(q),
    );
  });
}

function sortValue(row: Row, key: SortKey): number | string | null {
  if (key === 'index') return row.index;
  if (key === 'status') return STATUS_RANK[row.status];
  if (key === 'latency') return row.latency_ms && row.latency_ms > 0 ? row.latency_ms : null;
  const cell = metricCell(row.metric_values[Number(key.slice(7))]);
  return cell.num ?? (cell.kind === 'na' ? null : cell.text);
}

/** Rows with no value for the key always sort last, in either direction. */
export function sortRows(rows: Row[], key: SortKey, dir: SortDir): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.index - b.index;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign || a.index - b.index;
    return String(x).localeCompare(String(y)) * sign || a.index - b.index;
  });
}

export function parseView(search: string): ViewState {
  const p = new URLSearchParams(search);
  const status = p.get('status') as StatusFilter | null;
  const sort = p.get('sort') ?? '';
  const validSort = sort === 'index' || sort === 'status' || sort === 'latency' || /^metric:\d+$/.test(sort);
  return {
    q: p.get('q') ?? '',
    status: status && STATUS_FILTERS.includes(status) ? status : 'all',
    sort: validSort ? (sort as SortKey) : 'index',
    dir: p.get('dir') === 'desc' ? 'desc' : 'asc',
    ...(p.get('dataset') ? { dataset: p.get('dataset') as string } : {}),
  };
}

/** Only non-default values are written, so a clean URL means the default view. */
export function viewToSearch(view: ViewState): string {
  const p = new URLSearchParams();
  if (view.q) p.set('q', view.q);
  if (view.status !== 'all') p.set('status', view.status);
  if (view.dataset) p.set('dataset', view.dataset);
  if (view.sort !== 'index' || view.dir !== 'asc') {
    p.set('sort', view.sort);
    p.set('dir', view.dir);
  }
  const text = p.toString();
  return text ? `?${text}` : '';
}

/** Lets Excel read UTF-8 (Arabic) without a import wizard. */
const BOM = String.fromCharCode(0xfeff);

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  // Leading = + - @ would execute as a formula in spreadsheet apps.
  const safe = /^[=+@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** `<metric>_<key>` columns for every metric_meta key present (judge reasons, edit audit). */
function metaColumns(rows: Row[], metricNames: string[]): Array<{ metric: string; key: string }> {
  const out: Array<{ metric: string; key: string }> = [];
  for (const metric of metricNames) {
    const keys = new Set<string>();
    for (const row of rows) for (const k of Object.keys(row.metric_meta?.[metric] ?? {})) keys.add(k);
    for (const key of keys) out.push({ metric, key });
  }
  return out;
}

export function rowsToCsv(rows: Row[], metricNames: string[]): string {
  const meta = metaColumns(rows, metricNames);
  const union = rows.some((r) => rowDatasetKey(r));
  const header = [
    'index',
    'status',
    ...(union ? ['dataset', 'dataset_version'] : []),
    'input',
    'output',
    'expected',
    ...metricNames,
    ...meta.map((m) => `${m.metric}_${m.key}`),
    'latency_ms',
    'trace_id',
    'item_id',
  ];
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.index + 1,
        row.status,
        ...(union
          ? [row.item_metadata?.qym_dataset ?? '', row.item_metadata?.qym_dataset_version ?? '']
          : []),
        row.input_full,
        row.output_full,
        row.expected_full,
        ...metricNames.map((_, i) => row.metric_values[i] ?? ''),
        ...meta.map((m) => row.metric_meta?.[m.metric]?.[m.key] ?? ''),
        row.latency_ms ?? '',
        row.trace_id ?? '',
        row.item_id ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
