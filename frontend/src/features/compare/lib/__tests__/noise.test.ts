import { describe, expect, it } from 'vitest';
import { binomPmf, computeSweepNoise, normalCdf, passAtK, passHatK, type NoiseItem } from '../noise';

// Golden values come from qym.core.reducers.noise_report (threshold 0.7).
const LEFT: Record<string, number[]> = {
  a: [1, 1, 0], b: [0, 0, 0], c: [1, 0, 1], d: [1, 1, 1], e: [0, 1, 0], f: [0.2, 0.9, 0.8],
};
const RIGHT: Record<string, number[]> = {
  a: [1, 1, 1], b: [1, 0, 0], c: [1, 1, 1], d: [0, 1, 1], e: [1, 1, 0], f: [0.9, 0.95, 0.9],
};
const items = (): NoiseItem[] =>
  Object.keys(LEFT).map((id) => ({
    leftScores: LEFT[id]!,
    rightScores: RIGHT[id]!,
    leftPasses: LEFT[id]!.map((v) => v >= 0.7),
    rightPasses: RIGHT[id]!.map((v) => v >= 0.7),
  }));

describe('noise model (mirrors noise_report)', () => {
  it('matches the Python reference without report_k', () => {
    const r = computeSweepNoise(items(), null);
    expect(r.passAtK!.delta).toBeCloseTo(0.16666666666666666, 9);
    expect(r.passAtK!.halfWidth).toBeCloseTo(0.2816161692657703, 6);
    expect(r.passAtK!.pValue).toBeCloseTo(0.24606918038626113, 5);
    expect(r.passHatK!.delta).toBeCloseTo(0.3333333333333333, 9);
    expect(r.passHatK!.halfWidth).toBeCloseTo(0.48213301511410195, 6);
    expect(r.avgAtK!.delta).toBeCloseTo(0.21388888888888888, 9);
    expect(r.avgAtK!.halfWidth).toBeCloseTo(0.2761629945894303, 6);
    expect(r.consistency!.halfWidth).toBeCloseTo(0.36476656049081574, 6);
    expect(r.consistency!.pValue).toBeCloseTo(0.5504924827498237, 5);
    expect(r.passAtK!.verdict).toBe('within_noise');
    expect(r.reliability).toBeNull();
  });

  it('honours report_k < samples', () => {
    const r = computeSweepNoise(items(), 2);
    expect(r.passAtK!.halfWidth).toBeCloseTo(0.2468369660546771, 6);
    expect(r.passHatK!.delta).toBeCloseTo(0.27777777777777785, 9);
    expect(r.passHatK!.halfWidth).toBeCloseTo(0.3741267838270879, 6);
  });

  it('gives no avg band when a single score per side cannot estimate variance', () => {
    const one: NoiseItem[] = [
      { leftPasses: [true], rightPasses: [false], leftScores: [1], rightScores: [0] },
      { leftPasses: [false], rightPasses: [false], leftScores: [0], rightScores: [0] },
    ];
    expect(computeSweepNoise(one, null).avgAtK).toBeNull();
  });

  it('flags a change beyond the band as improved / regressed by direction', () => {
    const many: NoiseItem[] = Array.from({ length: 40 }, () => ({
      leftPasses: [false, false], rightPasses: [true, true], leftScores: [0.1, 0.2], rightScores: [0.9, 0.95],
    }));
    expect(computeSweepNoise(many, null, 'maximize').avgAtK!.verdict).toBe('improved');
    expect(computeSweepNoise(many, null, 'minimize').avgAtK!.verdict).toBe('regressed');
  });
});

describe('estimators', () => {
  it('pass@k and pass^k unbiased forms', () => {
    expect(passAtK(3, 1, 3)).toBeCloseTo(1);
    expect(passAtK(3, 0, 2)).toBeCloseTo(0);
    expect(passAtK(4, 1, 2)).toBeCloseTo(0.5);
    expect(passHatK(3, 3, 3)).toBe(1);
    expect(passHatK(4, 2, 2)).toBeCloseTo(1 / 6);
    expect(passAtK(2, 1, 3)).toBeNull();
  });
  it('binomial pmf sums to 1 and normal cdf is symmetric', () => {
    expect(binomPmf(5, 0.3).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(binomPmf(3, 0)).toEqual([1, 0, 0, 0]);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.2) + normalCdf(1.2)).toBeCloseTo(1, 6);
  });
});
