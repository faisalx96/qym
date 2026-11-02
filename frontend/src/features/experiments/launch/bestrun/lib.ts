import type { BestRunRow, BestRunsPayload } from '@/api/launch';

/** "kb_version" -> "kb version": short words read as acronyms. */
export function keyWords(key: string): string {
  const words = String(key)
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.toLowerCase()));
  return words.length ? words.join(' ') : String(key);
}

export function runCount(n: number): string {
  return `${n} run${n === 1 ? '' : 's'}`;
}

export function shortId(id: string | null | undefined): string {
  return String(id ?? '').slice(0, 8);
}

/** "temperature=0.2 model=gpt-4o" from a run's swept params. */
export function sweepText(params: BestRunRow['params']): string {
  const sweep = params?.sweep;
  if (!sweep || typeof sweep !== 'object') return '';
  return Object.keys(sweep)
    .map((pointer) => {
      const key = String(pointer).split('/').pop();
      const value = sweep[pointer];
      let shown: string;
      if (value && typeof value === 'object') {
        const v = value as Record<string, unknown>;
        const t = v['temporary'] as Record<string, unknown> | undefined;
        shown = String(v['name'] ?? v['model'] ?? t?.['label'] ?? t?.['model'] ?? 'object');
      } else shown = String(value);
      return `${key}=${shown}`;
    })
    .join(' ');
}

/** What the ranked runs were ranked on. */
export function scopeSummary(data: Pick<BestRunsPayload, 'scope'> | null | undefined): string {
  const scope = data?.scope;
  if (!scope) return '';
  if (scope.global) return 'Every run of this environment';
  const parts: string[] = [];
  const dataset = scope.dataset as { name: string } | null;
  const version = scope.dataset_version as { version: string } | null;
  if (dataset) parts.push(dataset.name + (version ? ` ${version.version}` : ' · any version'));
  else parts.push('Any dataset');
  for (const key of Object.keys(scope.versioning ?? {}).sort())
    parts.push(`${keyWords(key)} ${(scope.versioning[key] as string[]).join(' or ')}`);
  return parts.join(' · ');
}
