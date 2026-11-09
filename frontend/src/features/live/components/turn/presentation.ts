import type { LiveMetricSpec } from '@/api/live';
import { formatDurationMs, formatNumericValue, formatPercentValue } from '@/lib/format';
import { formatTableDate } from '@/lib/dates';
import { humanizeKey } from '@/lib/humanizeKey';
import { diagnosisSpec, mixSegments } from '../../lib/mix';

export function labelFor(value: string | null, specs: LiveMetricSpec[]) {
  return (
    mixSegments(value ? { [value]: 1 } : {}, diagnosisSpec(specs)).find((item) => item.value === value) ?? {
      label: value ?? '—',
      tone: 'neutral' as const,
      specTone: undefined,
      dark: false,
    }
  );
}

/** Time units print with no space before them ('13.3s', C-20). */
const TIME_UNITS = new Set(['s', 'ms', 'min', 'h']);

const STATUS_WORDS: Record<string, string> = { ok: 'OK', failed: 'Failed', skipped: 'Skipped' };

/** A raw Live status value as a word ('ok' → 'OK'). */
export function statusWord(value: string): string {
  return STATUS_WORDS[value] ?? humanizeKey(value);
}

export function scoreText(value: number | null, spec?: LiveMetricSpec | null): string {
  if (value === null) return '—';
  if (!spec || spec.score_type === 'percentage') return formatPercentValue(value, 1);
  if (spec.score_type === 'boolean') return value ? 'Pass' : 'Fail';
  if (spec.score_type === 'duration' && spec.unit === 'ms') return formatDurationMs(value);
  const unit = spec.unit ? (TIME_UNITS.has(spec.unit) ? spec.unit : ` ${spec.unit}`) : '';
  return `${formatNumericValue(value, spec.precision ?? 2)}${unit}`;
}

/** A Live instant on the viewer clock: 'Nov 5 · 17:45' ('—' for an invalid value). */
export function liveTime(value: string): string {
  return formatTableDate(value);
}

/** cv3-shim: remove after C-02 (renamed liveTime). */
export const utcTime = liveTime;

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
