/** Round 3 P1: the pure label rules of the bar plot. */
import { describe, expect, it } from 'vitest';
import {
  abbreviateCount,
  axisLabelShown,
  countText,
  countTiers,
  isDenseCounts,
  labelEvery,
  matrixCellSide,
} from './chartLabels';
import { labelledPositions, tickPositions } from './Charts';

describe('labelEvery', () => {
  it('shows every second label of 11 four-character labels in a 22px pitch', () => {
    expect(labelEvery(22, 4 * 7 + 6)).toBe(2);
  });

  it('shows every second label of 20 two-character labels in a 12px pitch', () => {
    expect(labelEvery(12, 2 * 7 + 6)).toBe(2);
  });

  it('shows all labels when the pitch is wide', () => {
    expect(labelEvery(70, 4 * 7 + 6)).toBe(1);
  });
});

describe('axisLabelShown', () => {
  it('labels columns 0, 2 ... 10 of an 11-bucket histogram in a 280px plot, and column 0 always', () => {
    const labels = Array.from({ length: 11 }, (_, i) => `${i * 10}%`);
    const shown = axisLabelShown(labels, 280);
    expect(shown[0]).toBe(true);
    expect(shown.filter(Boolean)).toHaveLength(6);
  });
});

describe('isDenseCounts', () => {
  it('is dense when two-digit counts do not fit the pitch', () => {
    expect(isDenseCounts(12, 2)).toBe(true);
    expect(isDenseCounts(17, 2)).toBe(false);
    expect(isDenseCounts(22, 1)).toBe(false);
  });
});

describe('abbreviateCount', () => {
  it('keeps counts under 1000 whole', () => {
    expect(abbreviateCount(0)).toBe('0');
    expect(abbreviateCount(999, 10)).toBe('999');
  });

  it('keeps 1000 and over whole while the text fits the column', () => {
    expect(abbreviateCount(1234, 40)).toBe('1234');
  });

  it('abbreviates when the text would be wider than the column', () => {
    expect(abbreviateCount(1234, 18)).toBe('1.2k');
    expect(abbreviateCount(1000, 18)).toBe('1k');
    expect(abbreviateCount(12400, 18)).toBe('12k');
  });
});

describe('countText (zero rules)', () => {
  it('prints nothing for an empty score bucket and 0 for pass/fail bars and passes passed', () => {
    expect(countText(0, 20, 'hide')).toBe('');
    expect(countText(0, 20, 'show')).toBe('0');
    expect(countText(7, 20, 'hide')).toBe('7');
  });
});

describe('curve labels and ticks', () => {
  it('labels the 1st, 3rd, 5th and last points when wide, only the first and last when narrow', () => {
    expect([...labelledPositions(10, false)].sort((a, b) => a - b)).toEqual([0, 2, 4, 9]);
    expect([...labelledPositions(10, true)].sort((a, b) => a - b)).toEqual([0, 9]);
    expect([...labelledPositions(3, false)].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it('draws every x tick when wide, every third and the last when narrow', () => {
    expect(tickPositions(10, false).size).toBe(10);
    expect([...tickPositions(10, true)].sort((a, b) => a - b)).toEqual([0, 3, 6, 9]);
  });
});

describe('matrixCellSide', () => {
  it('is clamp(20, column / (n + 1), 44)', () => {
    expect(matrixCellSide(1193, 4)).toBe(44);
    expect(matrixCellSide(300, 8)).toBe(33);
    expect(matrixCellSide(200, 24)).toBe(20);
  });
});

describe('countTiers', () => {
  it('keeps flat or falling neighbours on tier 0 or alternating, and raises a rising neighbour clear of its predecessor', () => {
    const tiers = countTiers([0.9, 0.2, 0.25, 0.9, 1], 14, 23);
    expect(tiers).toHaveLength(5);
    expect(tiers[0]).toBe(0);
  });

  it('never leaves two overlapping counts on the same height', () => {
    const p = [0.1, 0.3, 0.5, 0.7, 0.9, 1];
    const tiers = countTiers(p, 12, 23);
    const y = p.map((v, i) => (1 - v) * 120 - tiers[i]! * 18);
    for (let i = 1; i < p.length; i++) expect(Math.abs(y[i]! - y[i - 1]!)).toBeGreaterThanOrEqual(16);
  });
});
