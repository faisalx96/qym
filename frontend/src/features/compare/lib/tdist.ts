/**
 * Student's t distribution for the paired baseline comparison. The vanilla
 * page used the normal approximation, which makes the band far too narrow
 * for the handful of items a filtered view can leave (n = 4 gives t = 3.18,
 * not 1.96). Converges to the normal for large n.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Lanczos approximation (g = 7), accurate to ~1e-15 for x > 0. */
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let sum = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i += 1) sum += (LANCZOS[i] as number) / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Continued fraction for the regularized incomplete beta (Numerical Recipes betacf). */
function betaCf(a: number, b: number, x: number): number {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}

/** Two-sided p-value P(|T| >= |t|) with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/** Two-sided critical value: P(|T| >= value) = 1 - confidence. */
const criticalCache = new Map<string, number>();
export function tCritical(df: number, confidence = 0.95): number {
  const key = `${df}:${confidence}`;
  const cached = criticalCache.get(key);
  if (cached !== undefined) return cached;
  const value = solveCritical(df, confidence);
  criticalCache.set(key, value);
  return value;
}

function solveCritical(df: number, confidence: number): number {
  const alpha = 1 - confidence;
  let lo = 0;
  let hi = 1;
  while (tTwoSidedP(hi, df) > alpha && hi < 1e6) hi *= 2;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
