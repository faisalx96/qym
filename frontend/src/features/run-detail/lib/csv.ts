/** CSV export of the filtered rows with a column picker (brief 04 J7, run.html performExport). */
import { isInternalMetaKey } from '@/lib/metrics';
import { bodyText } from './itemText';
import { pickReason } from './itemReasons';
import { rootCauseIssues } from './rowMeta';
import type { RunModel } from './runModel';
import type { Row } from '../types';

export interface CsvColumn {
  id: string;
  label: string;
  group: 'Core' | 'Content' | 'Metadata' | string;
  /** The CSV header cell when it differs from the picker label (the old page's keys: `#`, `meta:k`, `m_score`). */
  header?: string;
  value: (row: Row) => string;
}

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(columns: CsvColumn[], rows: Row[]): string {
  const lines = [columns.map((c) => csvEscape(c.header ?? c.label)).join(',')];
  rows.forEach((row) => lines.push(columns.map((c) => csvEscape(c.value(row))).join(',')));
  return lines.join('\r\n');
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

const scalar = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function discoverColumns(rows: Row[], model: RunModel): CsvColumn[] {
  const cols: CsvColumn[] = [
    { id: 'index', label: 'index', header: '#', group: 'Core', value: (r) => String(r.index + 1) },
    { id: 'item_id', label: 'item_id', group: 'Core', value: (r) => r.item_id },
    { id: 'status', label: 'status', group: 'Core', value: (r) => String(r.status ?? '') },
    { id: 'error', label: 'error', group: 'Core', value: (r) => String(r.error ?? '') },
    {
      id: 'latency_ms',
      label: 'latency_ms',
      group: 'Core',
      value: (r) => (r.latency_ms != null ? String(r.latency_ms) : ''),
    },
    { id: 'retry_count', label: 'retry_count', group: 'Core', value: (r) => String(r.retry_count ?? 0) },
    { id: 'trace_id', label: 'trace_id', group: 'Core', value: (r) => String(r.trace_id ?? '') },
    { id: 'trace_url', label: 'trace_url', group: 'Core', value: (r) => String(r.trace_url ?? '') },
  ];
  const sub = (field: 'input' | 'expected' | 'output', get: (r: Row) => unknown) => {
    cols.push({ id: field, label: field, group: 'Content', value: (r) => bodyText(get(r)) });
    const keys = new Set<string>();
    rows.slice(0, 200).forEach((r) => Object.keys(parseObject(get(r)) ?? {}).forEach((k) => keys.add(k)));
    Array.from(keys)
      .sort()
      .forEach((k) =>
        cols.push({
          id: `${field}.${k}`,
          label: `${field}.${k}`,
          group: 'Content',
          value: (r) => scalar(parseObject(get(r))?.[k]),
        }),
      );
  };
  sub('input', (r) => r.input_full ?? r.input ?? r.input_preview);
  sub('expected', (r) => r.expected_full ?? r.expected);
  sub('output', (r) => r.output_full ?? r.output);
  const metaKeys = new Set<string>();
  rows.forEach((r) =>
    Object.keys(r.item_metadata ?? {}).forEach(
      (k) => k !== 'task_started_at_ms' && k !== 'trace_stats' && metaKeys.add(k),
    ),
  );
  Array.from(metaKeys)
    .sort()
    .forEach((k) =>
      cols.push({
        id: `meta.${k}`,
        label: k,
        header: `meta:${k}`,
        group: 'Metadata',
        value: (r) => scalar(r.item_metadata?.[k]),
      }),
    );
  model.metricNames.forEach((m, i) => {
    const group = `Metric: ${m}`;
    cols.push({
      id: `${m}.score`,
      label: m,
      header: `${m}_score`,
      group,
      value: (r) => scalar(r.metric_values?.[i]),
    });
    cols.push({
      id: `${m}.reason`,
      label: `${m}.reason`,
      header: `${m}:reason`,
      group,
      value: (r) => {
        const picked = pickReason({ meta: r.metric_meta?.[m] });
        return picked.kind === 'none' ? '' : picked.text;
      },
    });
    cols.push({
      id: `${m}.root_cause_issues`,
      label: `${m}.root_cause_issues`,
      header: `${m}:root_cause_issues`,
      group,
      value: (r) => {
        const issues = rootCauseIssues(r.item_metadata?.metric_analyses?.[m]);
        return issues.length ? JSON.stringify(issues) : '';
      },
    });
    const keys = new Set<string>();
    rows
      .slice(0, 200)
      .forEach((r) =>
        Object.keys(r.metric_meta?.[m] ?? {}).forEach(
          (k) => !isInternalMetaKey(k) && k !== 'reason' && keys.add(k),
        ),
      );
    Array.from(keys)
      .sort()
      .forEach((k) =>
        cols.push({
          id: `${m}.meta.${k}`,
          label: `${m}.${k}`,
          header: `${m}:${k}`,
          group,
          value: (r) => scalar((r.metric_meta?.[m] as Record<string, unknown> | undefined)?.[k]),
        }),
      );
  });
  return cols;
}
