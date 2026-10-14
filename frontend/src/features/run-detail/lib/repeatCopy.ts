/** Direction-aware help copy for the Repeat tab (ported from the old page's getMetricTooltips). */
import type { MetricDirection } from '@/lib/metrics';

export interface RepeatCopy {
  passAtK: string;
  passHatK: string;
  consistency: string;
  reliability: string;
  avgScore: string;
  avgLatency: string;
  medianLatency: string;
  errors: string;
}

export function repeatCopy(
  k: number,
  isBoolean: boolean,
  thresholdPct: number,
  direction: MetricDirection,
): RepeatCopy {
  const lower = direction === 'minimize';
  const rule = `${lower ? '≤' : '≥'}${thresholdPct}%`;
  const best = lower ? 'the best score (0%)' : 'a perfect score (100%)';
  return {
    passAtK: isBoolean
      ? `Percentage of items where at least one of the ${k} runs achieved ${best}.`
      : `Percentage of items where at least one of the ${k} runs scored ${rule}.`,
    passHatK: isBoolean
      ? `Percentage of items where all ${k} runs achieved ${best}.`
      : `Percentage of items where all ${k} runs scored ${rule}.`,
    consistency: `How often runs agree on pass/fail across ${k} runs. 100% = all runs agree, 0% = 50/50 split.`,
    reliability:
      'When an item can be solved, how often is it? Only items with at least one passing run count.',
    avgScore: 'The mean score across all items and all runs.',
    avgLatency: 'The mean response time across all items and all runs.',
    medianLatency:
      'The median response time across all items and all runs. Less sensitive to outliers than the mean.',
    errors: lower
      ? 'Item evaluations that returned a task or scorer error, across all passes. Lower is better for this metric, so errors are left out of its scores and count as fails.'
      : 'Item evaluations that returned a task or scorer error, across all passes. Errors are scored as 0%.',
  };
}

export type RepeatStatistic = 'compare' | 'pass_at_k' | 'pass_hat_k' | 'cumulative_avg';

export interface StatisticOption {
  key: RepeatStatistic;
  label: string;
  xLabel: string;
  copy: string;
}

/** The curve's statistics: pass-based metrics offer all four, numeric or undirected ones only the average. */
export function statisticOptions(passBased: boolean): StatisticOption[] {
  const average: StatisticOption = {
    key: 'cumulative_avg',
    label: 'Average',
    xLabel: 'Passes observed',
    copy: 'Average score as observed passes are added.',
  };
  if (!passBased) return [average];
  return [
    {
      key: 'compare',
      label: 'Compare',
      xLabel: 'Attempts allowed',
      copy: 'Compare the chance of any success with the chance of consistent success as attempts increase.',
    },
    {
      key: 'pass_at_k',
      label: 'Pass@k',
      xLabel: 'Attempts allowed',
      copy: 'Probability that at least one of k selected attempts passes.',
    },
    {
      key: 'pass_hat_k',
      label: 'Pass^k',
      xLabel: 'Attempts allowed',
      copy: 'Probability that all k selected attempts pass.',
    },
    average,
  ];
}

/** "Pass 3 of 5 queued" / "Passes 3–5 of 5 queued", or null when nothing is queued. */
export function queuedLabel(queued: number, total: number, samples: number): string | null {
  if (queued <= 0) return null;
  return queued === 1
    ? `Pass ${total} of ${samples} queued`
    : `Passes ${total - queued + 1}–${total} of ${samples} queued`;
}

/** One sentence that reads the summary: how far "passes at least once" is from "passes every time". */
export function verdictLine(
  stats: { pass_at_k?: number | null; pass_hat_k?: number | null } | null | undefined,
  k: number,
): string | null {
  const at = stats?.pass_at_k;
  const hat = stats?.pass_hat_k;
  if (k < 2 || at == null || hat == null) return null;
  const pct = (v: number) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
  const gap = Math.round((at - hat) * 100);
  const lead = `Pass@${k} ${pct(at)}, Pass^${k} ${pct(hat)}: `;
  if (gap < 1) return `${lead}items that pass once pass every time, so results are consistent.`;
  return `${lead}${gap} pts of items pass at least once but not every time.`;
}
