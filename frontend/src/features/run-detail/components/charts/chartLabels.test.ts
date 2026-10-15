/** Round 3 P1: the pure label rules of the bar plot. */
import { describe, expect, it } from 'vitest';
import { THIN_AXIS_BELOW, abbreviateCount, countText, matrixCellSide, thinAxisLabels } from './chartLabels';
import { labelledPositions, tickPositions } from './Charts';

describe('thinAxisLabels', () => {
  it('shows every label when the columns are 30px or wider', () => {
    expect(thinAxisLabels(11, 30)).toEqual(Array(11).fill(true));
    expect(thinAxisLabels(3, 80)).toEqual([true, true, true]);
  });

  it('shows every second label (0%, 20% ... 100%) under 30px, so 6 of 11', () => {
    const shown = thinAxisLabels(11, THIN_AXIS_BELOW - 1);
    expect(shown.filter(Boolean)).toHaveLength(6);
    expect(shown.map((v, i) => (v ? i * 10 : null)).filter((v) => v !== null)).toEqual([
      0, 20, 40, 60, 80, 100,
    ]);
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
