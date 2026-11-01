import type { LiveMetricSpec } from '@/api/live';
import type { CardTone } from '@/ui';

interface MixSegment {
  value: string;
  label: string;
  tone: CardTone;
  n: number;
  share: number;
}

function labelTone(tone: unknown): CardTone {
  switch (tone) {
    case 'success':
    case 'info':
    case 'accent':
    case 'warning':
    case 'danger':
    case 'meta':
      return tone;
    default:
      return 'neutral';
  }
}

export function diagnosisSpec(specs: LiveMetricSpec[]): LiveMetricSpec | null {
  const candidates = specs.filter((spec) => spec.score_type === 'categorical' && spec.group === 'diagnosis');
  return (
    candidates.find((spec) => spec.is_primary) ??
    candidates.sort((a, b) => a.position - b.position)[0] ??
    null
  );
}

export function mixSegments(counts: Record<string, number>, spec: LiveMetricSpec | null): MixSegment[] {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];
  const labels = new Map<string, { label: string; tone: CardTone }>();
  for (const item of spec?.values ?? []) {
    if (typeof item.value !== 'string') continue;
    labels.set(item.value, {
      label: typeof item.label === 'string' ? item.label : item.value,
      tone: labelTone(item.tone),
    });
  }
  for (const value of Object.keys(counts)) {
    if (!labels.has(value)) labels.set(value, { label: value, tone: 'neutral' });
  }
  return [...labels].map(([value, label]) => ({
    value,
    ...label,
    n: counts[value] ?? 0,
    share: (counts[value] ?? 0) / total,
  }));
}
