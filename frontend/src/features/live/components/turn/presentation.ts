import type { LiveMetricSpec } from '@/api/live';
import { formatDurationMs, formatNumericValue, formatPercentValue } from '@/lib/format';
import { humanizeKey } from '@/lib/humanizeKey';
import { diagnosisSpec, mixSegments } from '../../lib/mix';

export function labelFor(value: string | null, specs: LiveMetricSpec[]) {
  return (
    mixSegments(value ? { [value]: 1 } : {}, diagnosisSpec(specs)).find((item) => item.value === value) ?? {
      label: value ?? '—',
      tone: 'neutral' as const,
    }
  );
}

const STATUS_WORDS: Record<string, string> = { ok: 'OK', failed: 'Failed', skipped: 'Skipped' };

/** A raw Live status value as a word ('ok' → 'OK'). */
export function statusWord(value: string): string {
  return STATUS_WORDS[value] ?? humanizeKey(value);
}

export function scoreText(value: number | null, spec?: LiveMetricSpec | null): string {
  if (value === null) return '—';
  if (!spec || spec.score_type === 'percentage') return formatPercentValue(value, spec?.precision ?? 0);
  if (spec.score_type === 'boolean') return value ? 'True' : 'False';
  if (spec.score_type === 'duration' && spec.unit === 'ms') return formatDurationMs(value);
  return `${formatNumericValue(value, spec.precision ?? 2)}${spec.unit ? ` ${spec.unit}` : ''}`;
}

export function utcTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} · ${date.toISOString().slice(11, 16)} UTC`;
}

export function traceHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function turnHref(slug: string, source: string, turnId: string, list?: string): string {
  return `/projects/${encodeURIComponent(slug)}/live/turns/${encodeURIComponent(turnId)}?${new URLSearchParams({ source, ...(list ? { list } : {}) })}`;
}
