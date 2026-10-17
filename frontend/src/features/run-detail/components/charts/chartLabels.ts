/** Pure label rules of the bar plot (round 3 P1): which axis labels show, how a count is written. */

/** A column narrower than this (CSS px) shows the label of every second bucket. */
export const THIN_AXIS_BELOW = 30;

/** Rough width of one mono digit at `--font-sm` (px), used to decide when `1234` must become `1.2k`. */
const DIGIT_PX = 7;

/** Which axis labels are shown: all of them, or every second one (0, 2, 4, ...) when the columns are narrower than 30px. */
export function thinAxisLabels(n: number, columnWidth: number): boolean[] {
  const thin = columnWidth < THIN_AXIS_BELOW;
  return Array.from({ length: n }, (_, i) => !thin || i % 2 === 0);
}

/** `1234` -> `1.2k` (and `12000` -> `12k`) when the plain text would be wider than the column; other counts stay whole. */
export function abbreviateCount(count: number, columnWidth: number = Infinity): string {
  const plain = String(count);
  if (count < 1000 || plain.length * DIGIT_PX <= columnWidth) return plain;
  const k = count / 1000;
  return `${k < 10 ? (Math.round(k * 10) / 10).toString() : Math.round(k).toString()}k`;
}

/**
 * The text printed on top of a bar. A score histogram prints nothing for an empty bucket (`zero: 'hide'`);
 * pass/fail bars and "Passes passed" print `0` (`zero: 'show'`) because "nobody always fails" is information.
 */
export function countText(count: number, columnWidth: number, zero: 'hide' | 'show'): string {
  if (count === 0) return zero === 'show' ? '0' : '';
  return abbreviateCount(count, columnWidth);
}

/** Cell side of the correlation matrix: `clamp(20px, column / (n + 1), 44px)`. */
export function matrixCellSide(columnWidth: number, n: number): number {
  return Math.round(Math.min(44, Math.max(20, columnWidth / (n + 1))));
}

/** A matrix cell prints its number only when it is this wide (px) or wider. */
export const MATRIX_NUMBER_MIN = 32;
