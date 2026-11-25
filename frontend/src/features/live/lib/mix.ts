import type { LiveMetricSpec } from '@/api/live';
import type { CardSeries, CardTone } from '@/ui';
import { DIAGNOSES, diagnosisFor } from './diagnosis';

interface MixSegment {
  value: string;
  label: string;
  tone: CardTone;
  series?: CardSeries;
  /** Fixed by worker label; custom values fall back to spec order. */
  color: string;
  /** Semantic tone, independent of the category colour, retained for verdict/count callers. */
  specTone: unknown;
  /** Legacy verdict hint; distribution marks use color instead. */
  dark: boolean;
  n: number;
  share: number;
}

/**
 * Legacy verdict styling for StateTags on other pages. Distribution colours use diagnosisColors instead:
 * each diagnosis value has its own colour, including values that share a spec tone.
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

/** Assign colours in spec order, reserving a distinct fallback for repeated tones (including success/accent). */
export function diagnosisColors(spec: LiveMetricSpec | null): Map<string, string> {
  const colors = new Map<string, string>();
  const used = new Set<string>();
  const tones: Record<string, string> = {
    success: 'var(--success)',
    accent: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--error)',
    info: 'var(--chart-1)',
    meta: 'var(--accent-tertiary)',
    neutral: 'var(--text-muted)',
  };
  const extra = ['var(--chart-5)', 'var(--chart-2)', 'var(--chart-3)'];
  for (const item of spec?.values ?? []) {
    if (typeof item.value !== 'string' || colors.has(item.value)) continue;
    const known = diagnosisFor(item.value);
    if (known) {
      colors.set(item.value, known.color);
      used.add(known.color);
      continue;
    }
    const base = (typeof item.tone === 'string' ? tones[item.tone] : undefined) ?? tones.neutral!;
    const color = used.has(base) ? (extra.find((candidate) => !used.has(candidate)) ?? base) : base;
    colors.set(item.value, color);
    used.add(color);
  }
  return colors;
}

export function diagnosisSpec(specs: LiveMetricSpec[]): LiveMetricSpec | null {
  const candidates = specs.filter((spec) => spec.score_type === 'categorical' && spec.group === 'diagnosis');
  const spec =
    candidates.find((spec) => spec.is_primary) ??
    candidates.sort((a, b) => a.position - b.position)[0] ??
    null;
  if (!spec) return null;
  const values = spec.values ?? [];
  // Older workers may advertise only the original six labels. Keep custom vocabularies intact.
  if (values.length && !values.some((item) => typeof item.value === 'string' && diagnosisFor(item.value)))
    return spec;
  const present = new Set(values.map((item) => item.value));
  return {
    ...spec,
    values: [
      ...values.map((item) => {
        const known = typeof item.value === 'string' ? diagnosisFor(item.value) : undefined;
        return known ? { ...item, label: known.label, tone: known.tone } : item;
      }),
      ...DIAGNOSES.filter((item) => !present.has(item.value)).map(({ value, label, tone }) => ({
        value,
        label,
        tone,
      })),
    ],
  };
}

export function mixSegments(counts: Record<string, number>, spec: LiveMetricSpec | null): MixSegment[] {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];
  const colors = diagnosisColors(spec);
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
  return [...labels].map(([value, label]) => {
    const known = diagnosisFor(value);
    return {
      value,
      ...label,
      ...(known
        ? { label: known.label, tone: known.tone, series: known.series, specTone: known.tone, dark: false }
        : {}),
      color: known?.color ?? colors.get(value) ?? 'var(--text-muted)',
      n: counts[value] ?? 0,
      share: (counts[value] ?? 0) / total,
    };
  });
}
