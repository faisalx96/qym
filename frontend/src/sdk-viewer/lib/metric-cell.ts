/** Coercion of the string-typed metric cells both SDK producers emit ("1", "0.83", "n/a", "computing..."). */
export type CellKind = 'pass' | 'fail' | 'score' | 'na';

export interface MetricCell {
  kind: CellKind;
  /** parsed number when the cell holds one (sorting, CSV, percentages) */
  num: number | null;
  text: string;
}

const NA = new Set([
  '',
  'n/a',
  'na',
  'pending',
  'error',
  'computing...',
  'running...',
  'none',
  'null',
  'nan',
]);
const YES = new Set(['✓', 'true', 'yes', 'pass', 'passed']);
const NO = new Set(['✗', 'false', 'no', 'fail', 'failed']);

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(text)) return null;
  const n = Number(text.replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}

export function metricCell(value: unknown): MetricCell {
  const text = String(value ?? '').trim();
  const key = text.toLowerCase();
  if (NA.has(key)) return { kind: 'na', num: null, text };
  if (YES.has(key)) return { kind: 'pass', num: 1, text };
  if (NO.has(key)) return { kind: 'fail', num: 0, text };
  const num = toNumber(text);
  if (num === null) return { kind: 'score', num: null, text };
  if (Math.abs(num - 1) < 1e-9) return { kind: 'pass', num, text };
  if (Math.abs(num) < 1e-9) return { kind: 'fail', num, text };
  return { kind: 'score', num, text };
}

/** 0..1 scores read as percentages elsewhere; here only the display string. */
export function formatScore(cell: MetricCell): string {
  if (cell.num === null) return cell.text || '—';
  if (cell.kind === 'pass') return '1';
  if (cell.kind === 'fail') return '0';
  return Number.isInteger(cell.num) ? String(cell.num) : String(Math.round(cell.num * 1000) / 1000);
}
