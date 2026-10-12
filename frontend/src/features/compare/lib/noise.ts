/**
 * Noise model for cohort (Sweep) deltas; mirrors `qym.core.reducers.noise_report`
 * (brief 05 §3 Sweep). Under "nothing changed" each item's pass count is
 * Binomial with the pooled pass rate, so the variance of every pass-metric
 * delta follows exactly from the estimator lookup tables; avg@k uses the
 * pooled within-item score variance. No simulation.
 */
import { metricDeltaVerdict, type DeltaVerdict, type MetricDirection } from '@/lib/metrics';

export const Z_95 = 1.959964;

/** Abramowitz-Stegun 7.1.26; |error| < 1.5e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Unbiased pass@k from n samples with c passes. */
export function passAtK(n: number, c: number, k: number): number | null {
  if (k <= 0 || k > n) return null;
  if (n - c < k) return 1;
  let product = 1;
  for (let i = n - c + 1; i <= n; i += 1) product *= 1 - k / i;
  return 1 - product;
}

/** Unbiased pass^k: C(c,k)/C(n,k). */
export function passHatK(n: number, c: number, k: number): number | null {
  if (k <= 0 || k > n) return null;
  if (c < k) return 0;
  let value = 1;
  for (let i = 0; i < k; i += 1) value *= (c - i) / (n - i);
  return value;
}

export function binomPmf(n: number, p: number): number[] {
  const pmf = new Array<number>(n + 1).fill(0);
  if (p <= 0) {
    pmf[0] = 1;
    return pmf;
  }
  if (p >= 1) {
    pmf[n] = 1;
    return pmf;
  }
  let term = Math.pow(1 - p, n);
  pmf[0] = term;
  for (let c = 1; c <= n; c += 1) {
    term *= ((n - c + 1) / c) * (p / (1 - p));
    pmf[c] = term;
  }
  return pmf;
}

function lutVariance(lut: number[], pmf: number[]): number {
  let mean = 0;
  let second = 0;
  for (let c = 0; c < lut.length; c += 1) {
    const w = pmf[c] ?? 0;
    const f = lut[c] ?? 0;
    mean += f * w;
    second += f * f * w;
  }
  return Math.max(0, second - mean * mean);
}

type PassMetric = 'passAtK' | 'passHatK' | 'consistency';
type Luts = Partial<Record<PassMetric, number[]>>;

function passLuts(n: number, kEff: number): Luts {
  const luts: Luts = { passAtK: [], passHatK: [] };
  for (let c = 0; c <= n; c += 1) {
    luts.passAtK!.push(passAtK(n, c, kEff) ?? 0);
    luts.passHatK!.push(passHatK(n, c, kEff) ?? 0);
  }
  if (n > 1) {
    luts.consistency = [];
    for (let c = 0; c <= n; c += 1) luts.consistency.push((2 * Math.max(c, n - c)) / n - 1);
  }
  return luts;
}

export interface NoiseItem {
  leftPasses: boolean[];
  rightPasses: boolean[];
  leftScores: number[];
  rightScores: number[];
}

export interface NoiseStat {
  delta: number;
  halfWidth: number;
  pValue: number;
  verdict: DeltaVerdict;
  items: number;
}

export interface NoiseReport {
  passAtK: NoiseStat | null;
  passHatK: NoiseStat | null;
  avgAtK: NoiseStat | null;
  consistency: NoiseStat | null;
  /** Never banded: its per-item exclusion rule makes the aggregate nonlinear. */
  reliability: null;
}

export function computeSweepNoise(
  items: NoiseItem[],
  reportK: number | null,
  direction: MetricDirection = 'maximize',
): NoiseReport {
  const names: PassMetric[] = ['passAtK', 'passHatK', 'consistency'];
  const sumsL: Record<string, number> = {};
  const sumsR: Record<string, number> = {};
  const variances: Record<string, number> = {};
  const counts: Record<string, number> = {};
  let avgDfItems = 0;

  for (const item of items) {
    const nL = item.leftPasses.length;
    const nR = item.rightPasses.length;
    if (!nL || !nR) continue;
    const cL = item.leftPasses.filter(Boolean).length;
    const cR = item.rightPasses.filter(Boolean).length;
    const pooled = (cL + cR) / (nL + nR);
    const lutsL = passLuts(nL, reportK ? Math.min(reportK, nL) : nL);
    const lutsR = passLuts(nR, reportK ? Math.min(reportK, nR) : nR);
    const pmfL = binomPmf(nL, pooled);
    const pmfR = binomPmf(nR, pooled);
    for (const name of names) {
      const a = lutsL[name];
      const b = lutsR[name];
      if (!a || !b) continue;
      sumsL[name] = (sumsL[name] ?? 0) + (a[cL] ?? 0);
      sumsR[name] = (sumsR[name] ?? 0) + (b[cR] ?? 0);
      counts[name] = (counts[name] ?? 0) + 1;
      variances[name] = (variances[name] ?? 0) + lutVariance(a, pmfL) + lutVariance(b, pmfR);
    }
    if (!item.leftScores.length || !item.rightScores.length) continue;
    const meanL = item.leftScores.reduce((s, v) => s + v, 0) / item.leftScores.length;
    const meanR = item.rightScores.reduce((s, v) => s + v, 0) / item.rightScores.length;
    sumsL.avgAtK = (sumsL.avgAtK ?? 0) + meanL;
    sumsR.avgAtK = (sumsR.avgAtK ?? 0) + meanR;
    counts.avgAtK = (counts.avgAtK ?? 0) + 1;
    const df = item.leftScores.length + item.rightScores.length - 2;
    if (df > 0) {
      avgDfItems += 1;
      let ss = 0;
      item.leftScores.forEach((v) => (ss += (v - meanL) ** 2));
      item.rightScores.forEach((v) => (ss += (v - meanR) ** 2));
      variances.avgAtK =
        (variances.avgAtK ?? 0) + (ss / df) * (1 / item.leftScores.length + 1 / item.rightScores.length);
    }
  }

  const stat = (name: string, verdictDirection: MetricDirection): NoiseStat | null => {
    const nItems = counts[name] ?? 0;
    if (!nItems) return null;
    // One score per item per side: the within-item variance is not estimable, so no band rather than a false +/-0.
    if (name === 'avgAtK' && !avgDfItems) return null;
    const delta = ((sumsR[name] ?? 0) - (sumsL[name] ?? 0)) / nItems;
    const sd = Math.sqrt(variances[name] ?? 0) / nItems;
    const halfWidth = Z_95 * sd;
    const pValue = sd > 0 ? 2 * (1 - normalCdf(Math.abs(delta) / sd)) : delta === 0 ? 1 : 0;
    return {
      delta,
      halfWidth,
      pValue,
      verdict: metricDeltaVerdict(delta, halfWidth, verdictDirection),
      items: nItems,
    };
  };
  return {
    passAtK: stat('passAtK', 'maximize'),
    passHatK: stat('passHatK', 'maximize'),
    avgAtK: stat('avgAtK', direction),
    consistency: stat('consistency', 'maximize'),
    reliability: null,
  };
}
