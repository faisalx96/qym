/**
 * Comparison statistics for one metric over a subset of items
 * (compare.html calculateComparisonStatsForMetric, brief 05 J4): per-run
 * averages, winners/ties, Pass@K, Pass^K, Max@K, consistency, reliability,
 * agreement, "how many runs were correct" distribution and error counts.
 * Errors enter the mean by the declared direction (lib/metrics getRowScore).
 */
import { bestMetricIndexes, isErrorRow } from '@/lib/metrics';
import type { CompareModel } from './model';
import { itemOutcomes, runOutcome, type MetricCtx } from './scoring';

export type Winner = number | 'tie' | null;

export interface ComparisonStats {
  runCount: number;
  totalCompared: number;
  wins: number[];
  ties: number;
  winners: Map<string, Winner>;
  avgScores: number[];
  avgLatencies: number[];
  errorCounts: number[];
  failedCount: number;
  passAtK: number;
  passHatK: number;
  maxAtK: number;
  itemsWithBest: number;
  consistencySum: number;
  reliabilitySum: number;
  itemsWithMultipleRuns: number;
  itemsWithAtLeastOnePass: number;
  allCorrect: number;
  allWrong: number;
  /** correctDistribution[n] = items on which n runs passed. */
  correctDistribution: number[];
  agreementRate: number;
  overallAvgScore: number;
  overallAvgLatency: number;
  allScoresMin: number;
  allScoresMax: number;
  allScoresTotal: number;
  allScoresCount: number;
  biggestWins: Array<{ itemId: string; winner: number; diff: number; scores: Array<number | null> }>;
}

export function computeComparisonStats(
  model: CompareModel,
  ctx: MetricCtx,
  itemIds: readonly string[] = model.itemIds,
): ComparisonStats {
  const n = model.runs.length;
  const idSet = new Set(itemIds);
  const s: ComparisonStats = {
    runCount: n,
    totalCompared: 0,
    wins: new Array<number>(n).fill(0),
    ties: 0,
    winners: new Map(),
    avgScores: [],
    avgLatencies: [],
    errorCounts: [],
    failedCount: 0,
    passAtK: 0,
    passHatK: 0,
    maxAtK: 0,
    itemsWithBest: 0,
    consistencySum: 0,
    reliabilitySum: 0,
    itemsWithMultipleRuns: 0,
    itemsWithAtLeastOnePass: 0,
    allCorrect: 0,
    allWrong: 0,
    correctDistribution: new Array<number>(n + 1).fill(0),
    agreementRate: 0,
    overallAvgScore: 0,
    overallAvgLatency: 0,
    allScoresMin: 0,
    allScoresMax: 0,
    allScoresTotal: 0,
    allScoresCount: 0,
    biggestWins: [],
  };

  let min = Infinity;
  let max = -Infinity;
  model.runs.forEach((run) => {
    const idx = run.metricIndex[ctx.metric];
    let scoreSum = 0;
    let scoreCount = 0;
    let latSum = 0;
    let latCount = 0;
    let errors = 0;
    for (const [itemId, row] of run.byItem) {
      if (!idSet.has(itemId)) continue;
      if (idx !== undefined) {
        const outcome = runOutcome(run, itemId, ctx, model);
        if (outcome && outcome.score !== null) {
          scoreSum += outcome.score;
          scoreCount += 1;
          s.allScoresTotal += outcome.score;
          s.allScoresCount += 1;
          if (outcome.score < min) min = outcome.score;
          if (outcome.score > max) max = outcome.score;
        }
      }
      if (row.latency_ms && row.status === 'completed') {
        latSum += row.latency_ms;
        latCount += 1;
      }
      if (isErrorRow(row)) errors += 1;
    }
    s.avgScores.push(scoreCount ? scoreSum / scoreCount : 0);
    s.avgLatencies.push(latCount ? latSum / latCount : 0);
    s.errorCounts.push(errors);
  });
  s.allScoresMin = s.allScoresCount ? min : 0;
  s.allScoresMax = s.allScoresCount ? max : 0;
  s.overallAvgScore = s.allScoresCount ? s.allScoresTotal / s.allScoresCount : 0;
  const lats = s.avgLatencies.filter((l) => l > 0);
  s.overallAvgLatency = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;

  const direction = ctx.direction;
  const isWorst = (score: number) =>
    direction === 'minimize' ? score > 0.9999 : direction === 'maximize' && score < 0.0001;
  let agreements = 0;
  for (const itemId of itemIds) {
    const { scores, verdicts, rows } = itemOutcomes(model, itemId, ctx);
    s.failedCount += rows.filter((r) => r && isErrorRow(r)).length;
    const valid = scores.filter((x): x is number => x !== null);
    const judged = verdicts.filter((v) => v !== undefined);
    if (valid.length > 0 && direction) {
      s.maxAtK += direction === 'minimize' ? Math.min(...valid) : Math.max(...valid);
      s.itemsWithBest += 1;
    }
    const numCorrect = judged.filter((v) => v === true).length;
    s.correctDistribution[numCorrect] = (s.correctDistribution[numCorrect] ?? 0) + 1;
    s.totalCompared += 1;
    if (valid.length < 2) {
      s.winners.set(itemId, null);
      if (numCorrect > 0) s.passAtK += 1;
      if (direction && scores.every((x) => x === null || isWorst(x))) s.allWrong += 1;
      if (numCorrect === judged.length && numCorrect > 0) s.allCorrect += 1;
      continue;
    }
    const maxScore = Math.max(...valid);
    const minScore = Math.min(...valid);
    const best = bestMetricIndexes(scores, direction);
    if (!direction) s.winners.set(itemId, null);
    else if (maxScore === minScore) {
      s.ties += 1;
      s.winners.set(itemId, 'tie');
    } else if (best.length === 1) {
      const w = best[0] as number;
      s.wins[w] = (s.wins[w] ?? 0) + 1;
      s.winners.set(itemId, w);
      s.biggestWins.push({ itemId, winner: w, diff: maxScore - minScore, scores });
    } else {
      s.ties += 1;
      s.winners.set(itemId, 'tie');
    }
    const allCorrectItem = judged.length > 0 && numCorrect === judged.length;
    if (allCorrectItem) {
      s.allCorrect += 1;
      s.passHatK += 1;
    }
    if (Boolean(direction) && valid.every(isWorst)) s.allWrong += 1;
    if (numCorrect > 0) s.passAtK += 1;
    if (judged.length > 1) {
      const maxAgree = Math.max(numCorrect, judged.length - numCorrect);
      s.consistencySum += (2 * maxAgree) / judged.length - 1;
      s.itemsWithMultipleRuns += 1;
      if (numCorrect > 0) {
        s.reliabilitySum += numCorrect / judged.length;
        s.itemsWithAtLeastOnePass += 1;
      }
    }
    if (maxScore - minScore < 0.1) agreements += 1;
  }
  s.agreementRate = s.totalCompared ? agreements / s.totalCompared : 0;
  s.biggestWins.sort((a, b) => b.diff - a.diff);
  s.biggestWins = s.biggestWins.slice(0, 5);
  return s;
}

/** Rates the stats strip shows (fractions of totalCompared). */
export function statRates(s: ComparisonStats) {
  const total = s.totalCompared;
  return {
    passAtK: total ? s.passAtK / total : 0,
    passHatK: total ? s.passHatK / total : 0,
    maxAtK: s.itemsWithBest ? s.maxAtK / s.itemsWithBest : 0,
    consistency: s.itemsWithMultipleRuns ? s.consistencySum / s.itemsWithMultipleRuns : null,
    reliability: s.itemsWithAtLeastOnePass ? s.reliabilitySum / s.itemsWithAtLeastOnePass : null,
  };
}
