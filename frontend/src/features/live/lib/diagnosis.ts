import type { CardSeries, StateTagTone } from '@/ui';

interface Diagnosis {
  value: string;
  label: string;
  tone: StateTagTone;
  series?: CardSeries;
  color: string;
}

/** Stable worker vocabulary: category colours never depend on spec order or the current counts. */
export const DIAGNOSES: readonly Diagnosis[] = [
  { value: 'agent_ok', label: 'Agent OK', tone: 'success', color: 'var(--success)' },
  { value: 'agent_problem', label: 'Agent problem', tone: 'danger', color: 'var(--error)' },
  { value: 'agent_suboptimal', label: 'Agent suboptimal', tone: 'warning', color: 'var(--warning)' },
  {
    value: 'manifest_problem',
    label: 'Manifest problem',
    tone: 'neutral',
    series: 1,
    color: 'var(--chart-1)',
  },
  { value: 'system_problem', label: 'System problem', tone: 'neutral', series: 5, color: 'var(--chart-5)' },
  { value: 'inconclusive', label: 'Inconclusive', tone: 'neutral', color: 'var(--text-muted)' },
  { value: 'needs_review', label: 'Needs review', tone: 'neutral', series: 2, color: 'var(--chart-2)' },
  { value: 'not_verified', label: 'Not verified', tone: 'neutral', series: 3, color: 'var(--chart-3)' },
  { value: 'not_judged', label: 'Not judged', tone: 'neutral', series: 6, color: 'var(--chart-6)' },
];

export function diagnosisFor(value: string | null | undefined): Diagnosis | undefined {
  return DIAGNOSES.find((item) => item.value === value);
}
