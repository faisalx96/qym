/**
 * Repeat stats computed in the browser (C085): Pass@k, Pass^k, the averages, the pass distribution and the band's
 * point estimates, from the pass_scores every row already carries. The tiles and the curve paint at once when the
 * metric or the Pass if threshold changes; the server's group-metrics response adds only the confidence band.
 *
 * The rules follow the server (api/runs.py run_group_metrics, qym.core.reducers.group_stats and
 * services/repeat_analysis.build_repeat_analysis): an errored pass (scorer or task error) never passes; for a
 * lower-is-better metric it is left out of the averages, elsewhere it counts as 0.
 */
import {
  errorsLeftOut,
  parseScoreValue,
  repeatPassOutcomes,
  type MetricDirection,
  type MetricRow,
} from '@/lib/metrics';
import type { GroupMetricsBand, GroupMetricsPayload } from '../types';

/** One item's passes for one metric: the value each pass counts as, and whether it can pass at all. */
interface ItemPasses {
  scores: (number | null)[];
  eligible: boolean[];
}

export function unbiasedPassAtK(n: number, c: number, k: number): number {
  if (k <= 0 || k > n) return 0;
  if (n - c < k) return 1;
  let product = 1;
  for (let i = n - c + 1; i <= n; i++) product *= 1 - k / i;
  return 1 - product;
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return out;
}

export function unbiasedPassHatK(n: number, c: number, k: number): number {
  if (k <= 0 || k > n || c < k) return 0;
  return comb(c, k) / comb(n, k);
}

/** The per-item passes the server reads for ``metric`` at ``threshold`` (run_group_metrics). */
export function itemPasses(
  rows: MetricRow[],
  metric: string,
  threshold: number,
  direction: MetricDirection,
): ItemPasses[] {
  const leftOut = errorsLeftOut(direction);
  // The server reads the pass metadata only where an errored pass's 0 could pass or would read as the best value.
  const readMeta = leftOut || threshold <= 0;
  const out: ItemPasses[] = [];
  for (const row of rows) {
    const raw = row.pass_scores?.[metric];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const outcomes = readMeta ? repeatPassOutcomes(row, metric) : null;
    const attempts = Array.isArray(row.pass_attempts) ? row.pass_attempts : [];
    const scores: (number | null)[] = [];
    const eligible: boolean[] = [];
    raw.forEach((value, index) => {
      const score = parseScoreValue(value);
      const outcome = outcomes?.[index];
      const errored = !!outcome && (outcome.scorerError || outcome.taskError);
      if (errored) {
        scores.push(leftOut ? null : (score ?? 0));
        eligible.push(false);
        return;
      }
      if (score === null) {
        // A pass with no score row yet (still running) is not read; one that ran without a score counts as 0
        // where the server does not read the metadata.
        if (readMeta || !attempts[index]) return;
        scores.push(0);
        eligible.push(true);
        return;
      }
      scores.push(score);
      eligible.push(true);
    });
    if (scores.length) out.push({ scores, eligible });
  }
  return out;
}

function passCount(item: ItemPasses, threshold: number, direction: MetricDirection): number {
  let count = 0;
  item.scores.forEach((score, index) => {
    if (score === null || !item.eligible[index]) return;
    if (direction === 'minimize' ? score <= threshold : score >= threshold) count++;
  });
  return count;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * The group-metrics payload without the confidence band: ``group`` (the tiles), ``band`` (point estimates for every
 * k) and ``distribution``. Null when no row carries pass scores for the metric.
 */
export function localRepeatStats(
  rows: MetricRow[],
  metric: string,
  threshold: number,
  samples: number,
  direction: MetricDirection,
  reportK: number | null = null,
): Pick<GroupMetricsPayload, 'group' | 'band' | 'distribution' | 'metric' | 'threshold' | 'samples'> | null {
  const items = itemPasses(rows, metric, threshold, direction);
  if (!items.length) return null;
  const leftOut = errorsLeftOut(direction);

  let passAtSum = 0;
  let passHatSum = 0;
  let maxSum = 0;
  let withScore = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let consistencySum = 0;
  let multiple = 0;
  let reliabilitySum = 0;
  let withPass = 0;
  const distribution = new Array<number>(samples + 1).fill(0);
  for (const item of items) {
    const n = item.scores.length;
    const c = passCount(item, threshold, direction);
    const k = reportK ? Math.min(reportK, n) : n;
    passAtSum += unbiasedPassAtK(n, c, k);
    passHatSum += unbiasedPassHatK(n, c, k);
    if (n > 1) {
      consistencySum += (2 * Math.max(c, n - c)) / n - 1;
      multiple++;
      if (c > 0) {
        reliabilitySum += c / n;
        withPass++;
      }
    }
    const valid = item.scores.filter((s): s is number => s !== null);
    if (valid.length) {
      maxSum += direction === 'minimize' ? Math.min(...valid) : Math.max(...valid);
      withScore++;
    }
    scoreSum += valid.reduce((a, b) => a + b, 0);
    scoreCount += valid.length;
    distribution[Math.min(c, samples)]! += 1;
  }
  const total = items.length;
  const everyPassLeftOut = leftOut && scoreCount === 0;
  const group: NonNullable<GroupMetricsPayload['group']> = {
    k: samples,
    total_items: total,
    pass_at_k: passAtSum / total,
    pass_hat_k: passHatSum / total,
    avg_at_k: everyPassLeftOut ? undefined : scoreCount ? scoreSum / scoreCount : 0,
    max_at_k: everyPassLeftOut ? undefined : withScore ? maxSum / withScore : 0,
    consistency: multiple ? consistencySum / multiple : undefined,
    reliability: withPass ? reliabilitySum / withPass : undefined,
  };

  const maxK = Math.max(...items.map((item) => item.scores.length));
  const band: Record<string, GroupMetricsBand> = {};
  for (let k = 1; k <= maxK; k++) {
    const inBand = items.filter((item) => item.scores.length >= k);
    const passAt: number[] = [];
    const passHat: number[] = [];
    const cumulative: number[] = [];
    for (const item of inBand) {
      const n = item.scores.length;
      const c = passCount(item, threshold, direction);
      passAt.push(unbiasedPassAtK(n, c, k));
      passHat.push(unbiasedPassHatK(n, c, k));
      const scored = item.scores.slice(0, k).filter((s): s is number => s !== null);
      if (scored.length) cumulative.push(average(scored));
    }
    band[String(k)] = {
      pass_at_k: average(passAt),
      pass_hat_k: average(passHat),
      cumulative_avg: cumulative.length ? average(cumulative) : undefined,
      n_items: inBand.length,
    };
  }
  return { metric, threshold, samples, group, band, distribution };
}

/**
 * The payload the Repeat section draws: the server's response when it answers this metric and threshold, else the
 * browser's numbers (no confidence band yet).
 */
export function repeatStatsView(
  server: GroupMetricsPayload | undefined,
  serverIsCurrent: boolean,
  local: ReturnType<typeof localRepeatStats>,
): GroupMetricsPayload | undefined {
  if (server && serverIsCurrent) return server;
  if (!local) return server;
  return {
    run_id: server?.run_id ?? '',
    direction: server?.direction,
    report_k: server?.report_k,
    ...local,
  };
}
