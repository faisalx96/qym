/** Performance area: the one place that turns a number or an instant into the words every page shows. */
import type { PerformanceTestType, PerformanceTier } from '@/api/performance';
import { APP_LOCALE, formatElapsed, formatTime } from '@/lib/dates';

export const TEST_NAME: Record<PerformanceTestType, string> = {
  breakpoint: 'Breakpoint',
  smoke: 'Smoke',
  soak: 'Soak',
};

export const KINDS: PerformanceTier[] = ['simple', 'medium', 'complex'];
export const KIND_NAME: Record<PerformanceTier, string> = {
  simple: 'Simple',
  medium: 'Medium',
  complex: 'Complex',
};
/**
 * The series colour of each kind of question where a chart needs one line per kind: indigo, lime, cyan. They share
 * no colour with the percentile lines (p50 sky, p95 amber, p99 slate) or a state (orange is "Not counted"), so one
 * colour means one thing on the run page (D8). A kind is always named in words too; as a label it is the Level tag.
 */
export const KIND_SERIES: Record<PerformanceTier, 5 | 6 | 7> = { simple: 5, medium: 6, complex: 7 };

/** The level of each kind on the Level tag (three bars: 1 grey, 2 orange, 3 red), as Complexity reads elsewhere. */
export const KIND_LEVEL: Record<PerformanceTier, 1 | 2 | 3> = { simple: 1, medium: 2, complex: 3 };

export const P95_HINT = '95% of answers were faster than this.';

const absent = (value: unknown): value is null | undefined => value === null || value === undefined;

/** 87529 -> '87.5s' (no space before a time unit). */
export const secs = (ms: number | null | undefined, digits = 1) =>
  absent(ms) ? '–' : `${(ms / 1000).toFixed(digits)}s`;

/** 87529 -> '87.5': seconds without the unit, for a column whose title names it. */
export const seconds = (ms: number | null | undefined) => (absent(ms) ? '–' : (ms / 1000).toFixed(1));

/** 1290 -> '21m 30s'. */
export const span = (value: number | null | undefined) => (absent(value) ? '–' : formatElapsed(value));

export const count = (value: number | null | undefined) =>
  absent(value) ? '–' : value.toLocaleString(APP_LOCALE);

export const pct = (value: number | null | undefined, digits = 1) =>
  absent(value) ? '–' : `${value.toFixed(digits)}%`;

/** An instant to the second on the viewer's clock: '14:23:02'. */
export const clock = (iso: string | null | undefined) =>
  iso ? `${formatTime(iso)}:${iso.slice(17, 19)}` : '–';

/** An instant a number of seconds after another. */
export const plus = (iso: string, after: number) => new Date(Date.parse(iso) + after * 1000).toISOString();
