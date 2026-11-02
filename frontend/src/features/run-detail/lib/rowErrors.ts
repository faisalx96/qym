/**
 * Error buckets (Errors section) and the error-filter URL codec, ported from
 * run.html collectRowErrors / getErrorBucketKey / errorLabelHash. The
 * prefix+hash encoding must stay byte-identical so old links reopen.
 */
import { isItemTaskError, isMetricErrorMeta, isTaskErrorRow } from '@/lib/metrics';
import type { Row } from '../types';

export type ErrorKind = 'Task error' | 'Metric error' | 'Trace error' | 'Analysis error';
export type ErrorSlot = 'task' | 'metric' | 'trace' | 'analysis';

export const ERROR_SLOTS: Array<[ErrorSlot, ErrorKind]> = [
  ['task', 'Task error'],
  ['metric', 'Metric error'],
  ['trace', 'Trace error'],
  ['analysis', 'Analysis error'],
];

export function slotOfKind(kind: string): ErrorSlot {
  const hit = ERROR_SLOTS.find(([, k]) => k === kind);
  return hit ? hit[0] : 'trace';
}

export interface ErrorBucket {
  kind: ErrorKind;
  label: string;
  count: number;
  itemIds: Set<string>;
}

export interface ErrorFilter {
  kind: ErrorKind | string;
  label: string;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function normalizeErrorLabel(value: unknown, fallback?: string): string {
  let text = stringify(value || '').trim();
  if (!text) text = fallback || 'Unknown error';
  text =
    text
      .replace(/^ERROR:\s*/i, '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ') || text;
  return text.replace(/\s+/g, ' ').trim();
}

export function splitErrorLabel(label: string): { title: string; detail: string } {
  const text = String(label ?? '').trim();
  const idx = text.indexOf(':');
  if (idx <= 0) return { title: text || 'Unknown error', detail: '' };
  const title = text.slice(0, idx).trim();
  const detail = text.slice(idx + 1).trim();
  if (!title || !detail) return { title: text || 'Unknown error', detail: '' };
  return { title, detail };
}

export function errorBucketKey(kind: string, label: string): string {
  const parts = splitErrorLabel(label);
  const title = parts.title.replace(/\s+/g, ' ').trim();
  const detail = parts.detail.replace(/\s+/g, ' ').trim();
  const visibleDetail = detail.length > 72 ? detail.slice(0, 69).trimEnd() : detail;
  return kind + '||' + title + '||' + visibleDetail;
}

function addBucket(
  buckets: Map<string, ErrorBucket>,
  kind: ErrorKind,
  label: string,
  count: number,
  itemId: string,
) {
  const key = errorBucketKey(kind, label);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { kind, label, count: 0, itemIds: new Set() };
    buckets.set(key, bucket);
  }
  bucket.count += Math.max(1, Number(count) || 1);
  if (itemId) bucket.itemIds.add(itemId);
}

export function rowTraceErrorCount(row: Row): number {
  const ts = row.trace_stats && typeof row.trace_stats === 'object' ? row.trace_stats : {};
  return Number(ts.tool_errors || ts.malformed_tool_calls || 0) + Number(ts.provider_errors || 0);
}

/** Collect a row's errors into `buckets` (repeatAggregate: the all-passes view of a repeat run). */
export function collectRowErrors(
  row: Row,
  buckets: Map<string, ErrorBucket>,
  repeatAggregate: boolean,
): void {
  const itemId = row.item_id || String(row.index ?? '');
  const passTaskErrors =
    repeatAggregate && Array.isArray(row.pass_attempts)
      ? row.pass_attempts.filter((attempt) => {
          if (!attempt) return false;
          return isTaskErrorRow(attempt) || String(attempt.status ?? '').toLowerCase() === 'timeout';
        })
      : [];
  if (passTaskErrors.length) {
    for (const attempt of passTaskErrors) {
      addBucket(
        buckets,
        'Task error',
        normalizeErrorLabel(attempt.error || attempt.output || '', 'Task failed'),
        1,
        itemId,
      );
    }
  } else if (isItemTaskError(row)) {
    const executionError = row.error || row.__execution_error || row.output_full || row.output || '';
    addBucket(buckets, 'Task error', normalizeErrorLabel(executionError, 'Task failed'), 1, itemId);
  }

  const aggregateMeta = row.metric_meta ?? {};
  const passMeta = row.pass_metric_meta ?? {};
  const names = new Set([...Object.keys(aggregateMeta), ...Object.keys(passMeta)]);
  names.forEach((metricName) => {
    const perPass = passMeta[metricName];
    const passErrors = Array.isArray(perPass) ? perPass.filter((meta) => isMetricErrorMeta(meta)) : [];
    const candidates = passErrors.length ? passErrors : [aggregateMeta[metricName]];
    candidates.forEach((meta) => {
      if (!isMetricErrorMeta(meta)) return;
      const m = meta as Record<string, unknown>;
      const fallback =
        String(m.status ?? '').toLowerCase() === 'timeout' ? 'Metric timed out' : 'Metric failed';
      addBucket(
        buckets,
        'Metric error',
        metricName + ': ' + normalizeErrorLabel(m.error, fallback),
        1,
        itemId,
      );
    });
  });

  const md = row.item_metadata ?? {};
  if (md.analysis_error)
    addBucket(
      buckets,
      'Analysis error',
      normalizeErrorLabel(md.analysis_error, 'Analysis failed'),
      1,
      itemId,
    );

  const ts = row.trace_stats && typeof row.trace_stats === 'object' ? row.trace_stats : {};
  const toolErrors = Number(ts.tool_errors || ts.malformed_tool_calls || 0);
  const providerErrors = Number(ts.provider_errors || 0);
  if (toolErrors > 0) addBucket(buckets, 'Trace error', 'Tool errors', toolErrors, itemId);
  if (providerErrors > 0) addBucket(buckets, 'Trace error', 'Provider errors', providerErrors, itemId);
}

export function collectErrors(rows: Row[], repeatAggregate: boolean): Map<string, ErrorBucket> {
  const buckets = new Map<string, ErrorBucket>();
  rows.forEach((row) => collectRowErrors(row, buckets, repeatAggregate));
  return buckets;
}

export function rowMatchesErrorFilter(
  row: Row,
  filter: ErrorFilter | null | undefined,
  repeatAggregate: boolean,
): boolean {
  if (!filter) return true;
  const buckets = new Map<string, ErrorBucket>();
  collectRowErrors(row, buckets, repeatAggregate);
  return buckets.has(errorBucketKey(filter.kind, filter.label));
}

/* ── URL encoding of error labels ── */

export const ERROR_LABEL_MAX = 80;
export const ERROR_LABEL_PREFIX = 40;

/** FNV-1a over UTF-16 code units + length, both base36 (errorLabelHash). */
export function errorLabelHash(label: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index++) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36) + '.' + label.length.toString(36);
}

export type ErrorFilterUrlValue =
  { kind: string; label: string } | { kind: string; prefix: string; hash: string };

export function errorFilterUrlValue(filter: ErrorFilter): ErrorFilterUrlValue {
  const label = String(filter.label);
  if (label.length <= ERROR_LABEL_MAX) return { kind: filter.kind, label };
  const prefix = Array.from(label).slice(0, ERROR_LABEL_PREFIX).join('');
  return { kind: filter.kind, prefix, hash: errorLabelHash(label) };
}

/** The run's own label a shortened URL value names, or null. */
export function errorLabelFromUrlValue(
  rows: Row[],
  repeatAggregate: boolean,
  kind: string,
  prefix: string,
  hash: string,
): string | null {
  for (const row of rows) {
    const buckets = new Map<string, ErrorBucket>();
    collectRowErrors(row, buckets, repeatAggregate);
    for (const bucket of buckets.values()) {
      if (
        bucket.kind === kind &&
        bucket.label.length > ERROR_LABEL_MAX &&
        bucket.label.startsWith(prefix) &&
        errorLabelHash(bucket.label) === hash
      ) {
        return bucket.label;
      }
    }
  }
  return null;
}
