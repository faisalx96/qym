/** Server `metric_directions` values → ScoreValue direction. */
export function metricDir(raw: string | null | undefined): 'higher' | 'lower' | 'none' {
  const v = String(raw ?? '').toLowerCase();
  if (!v) return 'higher';
  if (v.includes('min') || v.includes('lower')) return 'lower';
  if (v.includes('max') || v.includes('higher')) return 'higher';
  return 'none';
}
