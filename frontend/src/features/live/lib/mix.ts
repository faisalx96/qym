import type { LiveMetricSpec } from '@/api/live';
import type { CardTone } from '@/ui';

interface MixSegment {
  value: string;
  label: string;
  tone: CardTone;
  /** The tone the spec gives the value (B-07). */
  specTone: unknown;
  /** Unanswerable (spec tone meta): the darker grey, --text-dim. */
  dark: boolean;
  n: number;
  share: number;
}

/**
 * A diagnosis value's colour by meaning (B-07), for its StateTag and its mix swatch: success or accent = green,
 * warning = orange, danger = red, info (Refused) = grey, meta (Unanswerable) = grey (a darker swatch).
 */
export function verdictOf(specTone: unknown): {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  dark: boolean;
} {
  switch (specTone) {
    case 'success':
    case 'accent':
      return { tone: 'success', dark: false };
    case 'warning':
      return { tone: 'warning', dark: false };
    case 'danger':
      return { tone: 'danger', dark: false };
    case 'info':
      return { tone: 'neutral', dark: false };
    case 'meta':
      return { tone: 'neutral', dark: true };
    default:
      return { tone: 'neutral', dark: false };
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
  const labels = new Map<string, { label: string; tone: CardTone; specTone: unknown; dark: boolean }>();
  for (const item of spec?.values ?? []) {
    if (typeof item.value !== 'string') continue;
    labels.set(item.value, {
      label: typeof item.label === 'string' ? item.label : item.value,
      tone: verdictOf(item.tone).tone,
      dark: verdictOf(item.tone).dark,
      specTone: item.tone,
    });
  }
  for (const value of Object.keys(counts)) {
    if (!labels.has(value))
      labels.set(value, { label: value, tone: 'neutral', dark: false, specTone: undefined });
  }
  return [...labels].map(([value, label]) => ({
    value,
    ...label,
    n: counts[value] ?? 0,
    share: (counts[value] ?? 0) / total,
  }));
}
