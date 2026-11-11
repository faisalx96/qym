/**
 * CSV export with a column picker (compare.html discoverExportColumns /
 * getCompareExportCellValue / performExport, brief 05 J7): shared fields,
 * parsed JSON keys of input / expected / output, item metadata, and per-run
 * output, status, root cause, issues, scores, metric meta, latency, trace URL.
 */
import { SKIPPED_METADATA } from './skipMetadata';
import { isInternalMetaKey } from '@/lib/metrics';
import type { Row } from '@/features/run-detail/types';
import {
  getRowRootCauseAnalyses,
  rootCauseCategories,
  rootCauseIssues,
} from '@/features/run-detail/lib/rowMeta';
import type { CompareModel } from './model';

export interface ExportColumn {
  key: string;
  label: string;
  checked: boolean;
}
export interface ExportGroup {
  group: string;
  columns: ExportColumn[];
}
export interface ExportItem {
  itemId: string;
  rows: Array<Row | null>;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Spreadsheet apps run a cell that starts with = + - @ (or a tab / CR) as a formula, and model
 * outputs are untrusted text; prefix those with an apostrophe. Plain numbers stay numbers.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && !NUMBER.test(value) ? `'${value}` : value;
}

/** An object, or a JSON / Python-dict string holding one. */
export function tryParseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!(s.startsWith('{') && s.endsWith('}'))) return null;
  for (const text of [
    s,
    s.replace(/'/g, '"').replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null'),
  ]) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      /* try the next form */
    }
  }
  return null;
}

const body = (row: Row | null, field: 'input' | 'expected' | 'output') =>
  row ? (row[`${field}_full` as 'input_full'] ?? row[field]) : undefined;

/**
 * `baseIdx`: the baseline run's position. Each other run gets a '<metric> change vs baseline' column per metric (K8,
 * C210).
 */
export function discoverExportColumns(model: CompareModel, items: ExportItem[], baseIdx = 0): ExportGroup[] {
  const groups: ExportGroup[] = [];
  const inputKeys = new Set<string>();
  const expectedKeys = new Set<string>();
  const outputKeys = new Set<string>();
  const metaKeys = new Set<string>();
  const metricMetaKeys = new Map<string, Set<string>>(model.metrics.map((m) => [m, new Set<string>()]));
  for (const { rows } of items) {
    const first = rows.find((r) => r);
    for (const k of Object.keys(first?.item_metadata ?? {})) if (!SKIPPED_METADATA.has(k)) metaKeys.add(k);
    for (const row of rows) {
      if (!row) continue;
      Object.keys(tryParseObject(body(row, 'input')) ?? {}).forEach((k) => inputKeys.add(k));
      Object.keys(tryParseObject(body(row, 'expected')) ?? {}).forEach((k) => expectedKeys.add(k));
      Object.keys(tryParseObject(body(row, 'output')) ?? {}).forEach((k) => outputKeys.add(k));
      for (const m of model.metrics)
        for (const k of Object.keys(row.metric_meta?.[m] ?? {}))
          if (!isInternalMetaKey(k)) metricMetaKeys.get(m)!.add(k);
    }
  }
  groups.push({
    group: 'Shared fields',
    columns: [
      { key: 'item_id', label: 'Aligned item ID', checked: true },
      { key: 'input', label: inputKeys.size ? 'Input (raw)' : 'Input', checked: inputKeys.size === 0 },
      {
        key: 'expected',
        label: expectedKeys.size ? 'Expected output (raw)' : 'Expected output',
        checked: expectedKeys.size === 0,
      },
    ],
  });
  if (inputKeys.size)
    groups.push({
      group: 'Input fields',
      columns: Array.from(inputKeys)
        .sort()
        .map((k) => ({ key: `input.${k}`, label: k, checked: true })),
    });
  if (expectedKeys.size)
    groups.push({
      group: 'Expected output fields',
      columns: Array.from(expectedKeys)
        .sort()
        .map((k) => ({ key: `expected.${k}`, label: k, checked: true })),
    });
  if (metaKeys.size)
    groups.push({
      group: 'Item metadata',
      columns: Array.from(metaKeys)
        .sort()
        .map((k) => ({ key: `meta:${k}`, label: k, checked: true })),
    });
  model.runs.forEach((run, ri) => {
    const cols: ExportColumn[] = [
      {
        key: `run:${ri}:output`,
        label: outputKeys.size ? 'Output (raw)' : 'Output',
        checked: outputKeys.size === 0,
      },
    ];
    for (const k of Array.from(outputKeys).sort())
      cols.push({ key: `run:${ri}:output.${k}`, label: `Output > ${k}`, checked: true });
    cols.push({ key: `run:${ri}:status`, label: 'Status', checked: true });
    cols.push({ key: `run:${ri}:root_cause`, label: 'Root cause', checked: true });
    cols.push({ key: `run:${ri}:root_cause_issues`, label: 'Root cause issues (JSON)', checked: true });
    for (const m of model.metrics) {
      cols.push({ key: `run:${ri}:${m}_score`, label: `${m} score`, checked: true });
      if (ri !== baseIdx && !model.unpaired)
        cols.push({ key: `run:${ri}:chg:${baseIdx}:${m}`, label: `${m} change vs baseline`, checked: true });
      for (const k of Array.from(metricMetaKeys.get(m) ?? []).sort())
        cols.push({ key: `run:${ri}:${m}:${k}`, label: `${m} > ${k}`, checked: true });
    }
    cols.push({ key: `run:${ri}:latency_ms`, label: 'Latency (ms)', checked: true });
    cols.push({ key: `run:${ri}:trace_url`, label: 'Trace URL', checked: true });
    groups.push({ group: run.label, columns: cols });
  });
  return groups;
}

export function exportCell(model: CompareModel, item: ExportItem, key: string): string {
  const first = item.rows.find((r) => r) ?? null;
  if (key === 'item_id') return item.itemId;
  if (key === 'input') return stringify(body(first, 'input'));
  if (key === 'expected') return stringify(body(first, 'expected'));
  if (key.startsWith('input.')) return stringify(tryParseObject(body(first, 'input'))?.[key.slice(6)]);
  if (key.startsWith('expected.')) return stringify(tryParseObject(body(first, 'expected'))?.[key.slice(9)]);
  if (key.startsWith('meta:')) return stringify(first?.item_metadata?.[key.slice(5)]);
  const m = key.match(/^run:(\d+):(.+)$/);
  if (!m) return '';
  const ri = parseInt(m[1] ?? '', 10);
  const field = m[2] ?? '';
  const row = item.rows[ri];
  const run = model.runs[ri];
  if (!row || !run) return '';
  if (field === 'output') return stringify(body(row, 'output'));
  if (field.startsWith('output.')) return stringify(tryParseObject(body(row, 'output'))?.[field.slice(7)]);
  if (field === 'status') return String(row.status ?? '');
  if (field === 'root_cause') {
    const a = getRowRootCauseAnalyses(row, 'all', false)[0];
    return a ? (rootCauseCategories(a)[0] ?? '') : '';
  }
  if (field === 'root_cause_issues') {
    const issues = getRowRootCauseAnalyses(row, 'all', false).flatMap((a) => rootCauseIssues(a, false));
    return issues.length ? JSON.stringify(issues.map(({ issue_id: _id, ...rest }) => rest)) : '';
  }
  const chg = field.match(/^chg:(\d+):(.+)$/);
  if (chg) {
    const metric = chg[2] ?? '';
    const baseRow = item.rows[parseInt(chg[1] ?? '', 10)];
    const baseRun = model.runs[parseInt(chg[1] ?? '', 10)];
    const value = (r: Row | null | undefined, cr: typeof run | undefined): number => {
      const idx = cr?.metricIndex[metric];
      const raw = idx === undefined || !r ? '' : (r.metric_values ?? [])[idx];
      return raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
    };
    const d = value(row, run) - value(baseRow, baseRun);
    return Number.isFinite(d) ? String(Math.round(d * 1e6) / 1e6) : '';
  }
  if (field === 'latency_ms') return String(row.latency_ms || '');
  if (field === 'trace_url') return row.trace_url || '';
  if (field.endsWith('_score')) {
    const idx = run.metricIndex[field.slice(0, -6)];
    return idx !== undefined ? stringify((row.metric_values ?? [])[idx]) : '';
  }
  const colon = field.indexOf(':');
  if (colon > 0)
    return stringify(
      (row.metric_meta?.[field.slice(0, colon)] as Record<string, unknown> | undefined)?.[
        field.slice(colon + 1)
      ],
    );
  return '';
}

export function buildCompareCsv(model: CompareModel, items: ExportItem[], columns: ExportColumn[]): string {
  const header = columns.map((c) => {
    const m = c.key.match(/^run:(\d+):/);
    return csvEscape(m ? `${model.runs[parseInt(m[1] ?? '', 10)]?.label ?? ''} / ${c.label}` : c.label);
  });
  const lines = [header.join(',')];
  for (const item of items)
    lines.push(columns.map((c) => csvEscape(neutralizeFormula(exportCell(model, item, c.key)))).join(','));
  return '﻿' + lines.join('\n');
}

export type ExportPreset = 'scores' | 'outputs' | 'everything';

/** The input field that holds the prompt, when the input is an object: question, prompt, query or input, else none. */
function promptKey(groups: ExportGroup[]): string | null {
  const keys = groups.find((g) => g.group === 'Input fields')?.columns.map((c) => c.key) ?? [];
  for (const name of ['question', 'prompt', 'query', 'input', 'text'])
    if (keys.includes(`input.${name}`)) return `input.${name}`;
  return null;
}

/**
 * The columns a preset ticks (K8, C210). 'Scores and change' (the default): the item id, the prompt, each run's score on
 * the page metric and each other run's change vs the baseline. 'Scores and outputs' adds each run's output.
 * 'Everything' ticks every column.
 */
export function presetKeys(groups: ExportGroup[], preset: ExportPreset, metric: string): Set<string> {
  const all = groups.flatMap((g) => g.columns.map((c) => c.key));
  if (preset === 'everything') return new Set(all);
  const prompt = promptKey(groups) ?? 'input';
  const keep = all.filter(
    (k) =>
      k === 'item_id' ||
      k === prompt ||
      k.endsWith(`:${metric}_score`) ||
      k.match(/^run:\d+:chg:\d+:(.+)$/)?.[1] === metric ||
      (preset === 'outputs' && /^run:\d+:output(\.|$)/.test(k)),
  );
  return new Set(keep);
}
