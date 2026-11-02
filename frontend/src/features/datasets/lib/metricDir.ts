/**
 * Server `metric_directions` values → ScoreValue direction. A metric that
 * declares no direction (null), or whose runs disagree, gets no colour.
 */
export function metricDir(raw: string | null | undefined): 'higher' | 'lower' | 'none' {
  const v = String(raw ?? '').toLowerCase();
  if (!v) return 'none';
  if (v.includes('min') || v.includes('lower')) return 'lower';
  if (v.includes('max') || v.includes('higher')) return 'higher';
  return 'none';
}
